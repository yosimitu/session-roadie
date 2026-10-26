import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { runSync, runSyncSince } from '../commands/sync.js';
import { runAuthStatus } from '../commands/authStatus.js';
import { emailFromAccessToken } from '../auth/accountEmail.js';
import { runScheduleStatus } from '../commands/scheduleStatus.js';
import { reconcile } from '../schedule/reconcile.js';
import { hasPlanChanges, saveScheduleBackup } from '../schedule/backup.js';
import { executeReconcilePlan, verifyAfterApply } from '../commands/applyPlan.js';
import { buildTravelBlockPlan, applyTravelBlocks } from '../commands/travelBlocks.js';
import { buildNoteReminderPlan, applyNoteReminders } from '../commands/noteReminders.js';
import { loadSnapshot } from '../catalog/store.js';
import { loadNotes, saveNotes } from '../profile/notesStore.js';
import { buildNotesSummary } from '../reporting/notesSummary.js';
import { buildProfileFromOnboarding, buildIntentFromOnboarding, type OnboardingAnswers } from '../onboarding/wizard.js';
import { findConflicts, findPersonalTimeConflicts } from '../commands/conflicts.js';
import { recommendForConflict } from '../planning/alternatives.js';
import { optimizeSchedule, lunchOverlapWarnings } from '../planning/optimize.js';
import { optimizeDefaultsFromProfile, datesWithinAttendance, searchDefaultsFromProfile } from '../planning/preferences.js';
import { searchCatalog, type CatalogQuery } from '../catalog/search.js';
import { loadProfile } from '../profile/profileStore.js';
import { loadIntent } from '../profile/intentStore.js';
import { signIn, signOut } from '../auth/signIn.js';
import { DEFAULT_EVENT_ID, DATA_DIR, NOTES_PATH, PROFILE_PATH, INTENT_PATH, SCHEDULE_HTML_PATH, SCHEDULE_ICS_PATH, getTokenStore, createClient } from '../runtimeContext.js';
import { runScheduleView } from '../commands/scheduleView.js';
import { runScheduleIcs } from '../commands/scheduleIcs.js';
import { formatBrief, runBrief } from '../commands/brief.js';
import { parseLang } from '../reporting/i18n.js';
import type { Session } from '../api/types.js';
import { runWatchOnce } from '../commands/watch.js';
import { formatWatchEvents } from '../commands/watchReport.js';
import { runTrends, formatTrends } from '../commands/trendsReport.js';
import { runNowGo, runSeatForecast, runDetour, formatNowGo, formatForecast, formatDetours, parseVenueLocalTime } from '../commands/insights.js';

// MCPツールのハンドラ本体。「ロジックは全部ここ」という方針（Claude Code → スキル/コマンド →
// re:Roadie → AWS Events REST API）に従い、McpServerへの配線（src/mcp/server.ts）とは独立させて
// テスト・再利用しやすくしている。確認プロンプトは持たず、常に非対話で動く
// （確認は呼び出し側＝スキル/コマンド経由のLLMが、plan系ツールの結果を見てから判断する）。

function resolveEventId(eventId?: string): string {
  return eventId ?? DEFAULT_EVENT_ID;
}

async function loadReservedSessions(eventId: string, client: Awaited<ReturnType<typeof createClient>>): Promise<{ schedule: Awaited<ReturnType<typeof runScheduleStatus>>; reservedSessions: Session[] }> {
  const schedule = await runScheduleStatus(client, eventId);
  const snapshot = loadSnapshot(eventId, DATA_DIR) ?? [];
  const snapshotById = new Map(snapshot.map((s) => [s.sessionId, s]));
  const reservedSessions = schedule.reserved.map((id) => snapshotById.get(id)).filter((s): s is Session => Boolean(s));
  return { schedule, reservedSessions };
}

export async function authStatusTool() {
  return runAuthStatus(getTokenStore());
}

export async function authLoginTool() {
  const token = await signIn(getTokenStore());
  const email = emailFromAccessToken(token.accessToken);
  return { signedIn: true, ...(email ? { email } : {}), expiresAt: new Date(token.expiresAt).toISOString() };
}

export async function authLogoutTool() {
  await signOut(getTokenStore());
  return { signedOut: true };
}

/**
 * sinceを指定すると「ここ一週間の新着は？」のように任意の過去日付（YYYY-MM-DD）との比較になる。
 * 省略時は前回保存分（runSync）との比較。
 */
export async function catalogSyncTool(eventId?: string, since?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  if (since) return runSyncSince(client, id, DATA_DIR, since);
  return runSync(client, id, DATA_DIR);
}

/**
 * 1回だけ確認する。繰り返しは呼び出し側（Claude Code の /loop など）が担う。
 * 予約は実行しない。空席表示は「予約できるとは限らない」ので、予約する場合は schedule_plan → 確認 → schedule_apply の順に進む。
 */
export async function catalogWatchTool(eventId?: string) {
  const client = await createClient();
  const result = await runWatchOnce(client, resolveEventId(eventId), DATA_DIR, loadProfile(PROFILE_PATH));
  return { ...result, lines: formatWatchEvents(result.events) };
}

/**
 * いまから間に合うセッション。at は会場の現地時刻 "YYYY-MM-DD HH:MM"（省略時は現在時刻。会期外の確認や試しに使う）。
 * 予約は実行しない。空席表示は予約できることを保証しない。
 */
export async function sessionsNowTool(eventId?: string, at?: string, venue?: string, withinMinutes?: number, limit?: number) {
  const now = at === undefined ? undefined : parseVenueLocalTime(at);
  if (at !== undefined && !now) throw new Error(`at は "YYYY-MM-DD HH:MM"（会場の現地時刻）の形で指定してください: "${at}"`);
  const result = await runNowGo(await createClient(), resolveEventId(eventId), DATA_DIR, loadProfile(PROFILE_PATH), { now, venue, withinMinutes, limit });
  return { ...result, lines: formatNowGo(result) };
}

/** 空席表示の履歴からの見積もり。取消や追加の席で変わり、残席数ではない。予約は実行しない */
export async function seatForecastTool(eventId?: string, horizonDays?: number, limit?: number) {
  const result = await runSeatForecast(await createClient(), resolveEventId(eventId), DATA_DIR, loadProfile(PROFILE_PATH), { horizonDays, limit });
  return { ...result, lines: formatForecast(result) };
}

/** 予約の合間に収まる、関心の外のセッションの提案。dates は会場の日付。予約は実行しない */
export async function detourSuggestTool(eventId?: string, dates?: string[], perDay?: number) {
  const result = await runDetour(await createClient(), resolveEventId(eventId), DATA_DIR, loadProfile(PROFILE_PATH), { dates, perDay });
  return { ...result, lines: formatDetours(result) };
}

/**
 * カタログの傾向。since は比べる基準日（保存済みの日付別スナップショット。省略時は最も古い日）。
 * 件数は掲載数で、AWS の注力や参加者数を表すとは限らない。サインインできなくても傾向は返す（個人との比較だけ省く）。
 */
export async function catalogTrendsTool(eventId?: string, since?: string, keywords?: string[], limit?: number) {
  const result = await runTrends(createClient, resolveEventId(eventId), DATA_DIR, { since, keywords, limit });
  return { ...result, lines: formatTrends(result) };
}

export async function scheduleGetTool(eventId?: string) {
  const client = await createClient();
  return runScheduleStatus(client, resolveEventId(eventId));
}

/**
 * 差分に加えて、profile.yaml で昼休みを空けたい設定のとき、これから予約するセッションが
 * 12:00〜13:00 にかかる場合の warnings を返す（予約は止めない。確認はユーザーが行う）。
 * スナップショットに無いIDは判定できないので警告に含めない。
 */
export async function schedulePlanTool(reserve: string[] | undefined, favorite: string[] | undefined, eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const actual = await runScheduleStatus(client, id);
  const plan = reconcile({ reserve, favorite }, actual);
  if (!loadProfile(PROFILE_PATH)?.lunchBreak) return { ...plan, warnings: [] };
  const snapshotById = new Map((loadSnapshot(id, DATA_DIR) ?? []).map((s) => [s.sessionId, s]));
  const toReserve = plan.toReserve.map((sid) => snapshotById.get(sid)).filter((s): s is Session => Boolean(s));
  return { ...plan, warnings: lunchOverlapWarnings(toReserve) };
}

/**
 * 企画書 §5.9: 実行後に必ずGetScheduleで再照合し、まだ差分が残っていないかを一緒に返す。
 * 再照合に失敗した場合は remainingPlan の代わりに reconcileError を返す（実行結果は失わない）。
 */
export async function scheduleApplyTool(reserve: string[] | undefined, favorite: string[] | undefined, eventId?: string) {
  const client = await createClient();
  const id = resolveEventId(eventId);
  const desired = { reserve, favorite };
  const before = await runScheduleStatus(client, id);
  const plan = reconcile(desired, before);
  const backupPath = hasPlanChanges(plan) ? saveScheduleBackup(id, before, DATA_DIR) : undefined;
  const result = await executeReconcilePlan(client, id, plan);
  const verify = await verifyAfterApply(client, id, desired);
  return { plan, result, ...(backupPath ? { backupPath } : {}), ...verify };
}

/**
 * 現在のスケジュールとカタログ全件を、タブ付きの参照専用HTML（data/schedule.html）に書き出す。予定は変更しない。
 * 出力先は固定（LLMが任意のパスへ書き込めないようにする）。date は会場PSTの "YYYY-MM-DD"。
 */
export async function scheduleViewTool(date?: string, eventId?: string, newSince?: string, lang?: string) {
  const id = resolveEventId(eventId);
  const snapshot = requireSnapshot(id);
  const client = await createClient(); // トークンの更新もここで済む
  return runScheduleView(client, id, {
    snapshot, outPath: SCHEDULE_HTML_PATH, profile: loadProfile(PROFILE_PATH), date, dataDir: DATA_DIR, newSince, lang: parseLang(lang),
    account: emailFromAccessToken(getTokenStore().loadRaw()?.accessToken),
  });
}

/**
 * 予約したセッションを、カレンダーアプリに取り込める .ics（data/schedule.ics）に書き出す。公式の予定は変更しない。
 * 出力先は固定（LLMが任意のパスへ書き込めないようにする）。favorites を true にすると、未予約のお気に入りも仮の予定として含める。
 */
export async function scheduleIcsTool(favorites?: boolean, eventId?: string) {
  const id = resolveEventId(eventId);
  const snapshot = requireSnapshot(id);
  return runScheduleIcs(await createClient(), id, { snapshot, outPath: SCHEDULE_ICS_PATH, favorites });
}

/**
 * 1日分の予約の要約（時刻順の予約、会場間の移動と空き時間、合計時間、警告）。date は会場の日付 "YYYY-MM-DD"。
 * 省略時は、会場現地の今日以降で予約のある最初の日。予定は変更しない。
 */
export async function dayBriefTool(date?: string, eventId?: string) {
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date は YYYY-MM-DD の形で指定してください: "${date}"`);
  const id = resolveEventId(eventId);
  const result = await runBrief(await createClient(), id, requireSnapshot(id), { date });
  if (!result) return { found: false, lines: ['今日以降の予約はありません'] };
  return { found: true, ...result, lines: formatBrief(result) };
}

export async function conflictsGetTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const { schedule, reservedSessions } = await loadReservedSessions(id, client);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  const sessionConflicts = findConflicts(reservedSessions).map((group) => {
    const { recommended, reasons } = recommendForConflict(group, snapshot);
    return { sessionIds: group.map((s) => s.sessionId), recommended: recommended.sessionId, reasons };
  });
  const personalTimeConflicts = findPersonalTimeConflicts(reservedSessions, schedule.personalTime);
  return { sessionConflicts, personalTimeConflicts };
}

function requireSnapshot(eventId: string): Session[] {
  const snapshot = loadSnapshot(eventId, DATA_DIR);
  if (!snapshot) throw new Error(`ローカルスナップショット（${eventId}）がありません。先に catalog_sync を実行してください`);
  return snapshot;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function profileGetTool() {
  const profile = loadProfile(PROFILE_PATH);
  return {
    profile: profile ?? null,
    intent: loadIntent(INTENT_PATH)?.freeText ?? null,
    optimizeDefaults: optimizeDefaultsFromProfile(profile),
  };
}

/**
 * 引数で指定しなかった条件は profile.yaml の値で補う（useProfile: false で無効化）。
 * dates ← 参加日の範囲、maxLevel ← 希望レベル（levels を指定したときは補わない）、excludeSponsored ← スポンサー除外。
 */
export function catalogSearchTool(query: CatalogQuery & { useProfile?: boolean }, eventId?: string) {
  const { useProfile = true, ...rest } = query;
  const snapshot = requireSnapshot(resolveEventId(eventId));
  const eventDates = [...new Set(snapshot.map((s) => s.sessionTime?.date).filter((d): d is string => Boolean(d)))].sort();
  const profile = useProfile ? loadProfile(PROFILE_PATH) : undefined;
  const profileDates = !rest.dates ? datesWithinAttendance(eventDates, profile) : undefined;
  const searchDefaults = searchDefaultsFromProfile(profile);
  const applied = {
    ...(profileDates ? { dates: profileDates } : {}),
    ...(rest.maxLevel === undefined && !rest.levels?.length && searchDefaults.maxLevel ? { maxLevel: searchDefaults.maxLevel } : {}),
    ...(rest.excludeSponsored === undefined && searchDefaults.excludeSponsored ? { excludeSponsored: true } : {}),
  };
  const result = searchCatalog(snapshot, { ...rest, ...applied });
  return { ...result, appliedProfileDefaults: applied };
}

export interface ScheduleOptimizeToolOptions {
  eventId?: string;
  considerTravelTime?: boolean;
  respectPersonalTime?: boolean;
  useProfile?: boolean;
  maxSessionsPerDay?: number;
  minGapMinutes?: number;
  preferredTypes?: string[];
  firstDay?: string;
  lastDay?: string;
  earliestStart?: string;
  lunchBreak?: boolean;
}

/**
 * 候補から重ならない最大の組み合わせを選ぶ（実行はしない）。結果の reserve を schedule_plan に渡して使う。
 * profile.yaml の体力・目的・参加日・開始時刻・昼休み・固定の予定を既定値として使い、引数で明示した値はそれより優先する。
 */
export async function scheduleOptimizeTool(candidates: string[], options: ScheduleOptimizeToolOptions = {}) {
  const id = resolveEventId(options.eventId);
  const snapshot = requireSnapshot(id);
  const personalTime = (options.respectPersonalTime ?? true)
    ? (await runScheduleStatus(await createClient(), id)).personalTime
    : [];

  const defaults = (options.useProfile ?? true) ? optimizeDefaultsFromProfile(loadProfile(PROFILE_PATH)) : {};
  const explicitDateRange = options.firstDay || options.lastDay
    ? { dateRange: { firstDay: options.firstDay, lastDay: options.lastDay } }
    : {};
  const appliedOptions = {
    ...defaults,
    ...withoutUndefined({
      maxSessionsPerDay: options.maxSessionsPerDay,
      minGapMinutes: options.minGapMinutes,
      preferredTypes: options.preferredTypes,
      earliestStart: options.earliestStart,
      lunchBreak: options.lunchBreak,
    }),
    ...explicitDateRange,
    considerTravelTime: options.considerTravelTime ?? true,
  };
  const result = optimizeSchedule(candidates, snapshot, personalTime, appliedOptions);
  return { ...result, appliedOptions };
}

export async function travelBlocksPlanTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const { schedule } = await loadReservedSessions(id, client);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  return buildTravelBlockPlan(schedule, snapshot);
}

export async function travelBlocksApplyTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const { schedule } = await loadReservedSessions(id, client);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  const plan = buildTravelBlockPlan(schedule, snapshot);
  const count = await applyTravelBlocks(client, id, plan.candidates);
  return { count };
}

export function notesListTool() {
  return loadNotes(NOTES_PATH);
}

export function notesAddTool(sessionId: string, text: string) {
  const all = loadNotes(NOTES_PATH);
  saveNotes(NOTES_PATH, { ...all, [sessionId]: text });
  return { saved: true };
}

export function notesReportTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const all = loadNotes(NOTES_PATH);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  return buildNotesSummary(all, snapshot);
}

export async function notesRemindersPlanTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const allNotes = loadNotes(NOTES_PATH);
  const schedule = await runScheduleStatus(client, id);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  return buildNoteReminderPlan(allNotes, snapshot, schedule);
}

export async function notesRemindersApplyTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const allNotes = loadNotes(NOTES_PATH);
  const schedule = await runScheduleStatus(client, id);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  const reminders = buildNoteReminderPlan(allNotes, snapshot, schedule);
  const count = await applyNoteReminders(client, id, reminders);
  return { count };
}

export function onboardingSaveTool(answers: OnboardingAnswers) {
  const profile = buildProfileFromOnboarding(answers);
  const intent = buildIntentFromOnboarding(answers);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROFILE_PATH, stringify(profile), 'utf-8');
  writeFileSync(INTENT_PATH, intent, 'utf-8');
  return { profile, intent, optimizeDefaults: optimizeDefaultsFromProfile(profile) };
}

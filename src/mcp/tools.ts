import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { runSync, runSyncSince } from '../commands/sync.js';
import { runAuthStatus } from '../commands/authStatus.js';
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
import { DEFAULT_EVENT_ID, DATA_DIR, NOTES_PATH, PROFILE_PATH, INTENT_PATH, SCHEDULE_HTML_PATH, getTokenStore, createClient } from '../runtimeContext.js';
import { runScheduleView } from '../commands/scheduleView.js';
import type { Session } from '../api/types.js';
import { runWatchOnce } from '../commands/watch.js';
import { formatWatchEvents } from '../commands/watchReport.js';

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
  return { signedIn: true, expiresAt: new Date(token.expiresAt).toISOString() };
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
export async function scheduleViewTool(date?: string, eventId?: string, newSince?: string) {
  const id = resolveEventId(eventId);
  const snapshot = requireSnapshot(id);
  return runScheduleView(await createClient(), id, {
    snapshot, outPath: SCHEDULE_HTML_PATH, profile: loadProfile(PROFILE_PATH), date, dataDir: DATA_DIR, newSince,
  });
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

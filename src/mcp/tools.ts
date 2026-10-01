import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { runSync, runSyncSince } from '../commands/sync.js';
import { runAuthStatus } from '../commands/authStatus.js';
import { runScheduleStatus } from '../commands/scheduleStatus.js';
import { reconcile } from '../schedule/reconcile.js';
import { executeReconcilePlan } from '../commands/applyPlan.js';
import { buildTravelBlockPlan, applyTravelBlocks } from '../commands/travelBlocks.js';
import { buildNoteReminderPlan, applyNoteReminders } from '../commands/noteReminders.js';
import { loadSnapshot } from '../catalog/store.js';
import { loadNotes, saveNotes } from '../profile/notesStore.js';
import { buildNotesSummary } from '../reporting/notesSummary.js';
import { buildProfileFromOnboarding, buildIntentFromOnboarding, type OnboardingAnswers } from '../onboarding/wizard.js';
import { findConflicts } from '../commands/conflicts.js';
import { recommendForConflict } from '../planning/alternatives.js';
import { signIn, signOut } from '../auth/signIn.js';
import { DEFAULT_EVENT_ID, DATA_DIR, NOTES_PATH, getTokenStore, createClient } from '../runtimeContext.js';
import type { Session } from '../api/types.js';

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
  const client = await createClient();
  const id = resolveEventId(eventId);
  if (since) return runSyncSince(client, id, DATA_DIR, since);
  return runSync(client, id, DATA_DIR);
}

export async function scheduleGetTool(eventId?: string) {
  const client = await createClient();
  return runScheduleStatus(client, resolveEventId(eventId));
}

export async function schedulePlanTool(reserve: string[], favorite: string[], eventId?: string) {
  const client = await createClient();
  const actual = await runScheduleStatus(client, resolveEventId(eventId));
  return reconcile({ reserve, favorite }, actual);
}

/** 企画書 §5.9: 実行後に必ずGetScheduleで再照合し、まだ差分が残っていないかを一緒に返す */
export async function scheduleApplyTool(reserve: string[], favorite: string[], eventId?: string) {
  const client = await createClient();
  const id = resolveEventId(eventId);
  const desired = { reserve, favorite };
  const before = await runScheduleStatus(client, id);
  const plan = reconcile(desired, before);
  const result = await executeReconcilePlan(client, id, plan);
  const after = await runScheduleStatus(client, id);
  const remainingPlan = reconcile(desired, after);
  return { plan, result, remainingPlan };
}

export async function conflictsGetTool(eventId?: string) {
  const id = resolveEventId(eventId);
  const client = await createClient();
  const { reservedSessions } = await loadReservedSessions(id, client);
  const snapshot = loadSnapshot(id, DATA_DIR) ?? [];
  const groups = findConflicts(reservedSessions);
  return groups.map((group) => {
    const { recommended, reasons } = recommendForConflict(group, snapshot);
    return { sessionIds: group.map((s) => s.sessionId), recommended: recommended.sessionId, reasons };
  });
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
  writeFileSync(join(DATA_DIR, 'profile.yaml'), stringify(profile), 'utf-8');
  writeFileSync(join(DATA_DIR, 'intent.txt'), intent, 'utf-8');
  return { profile, intent };
}

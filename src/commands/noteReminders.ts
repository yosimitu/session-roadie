import type { ApiClient } from '../api/client.js';
import type { PersonalTimeInput, Schedule, Session } from '../api/types.js';
import type { NotesBySessionId } from '../profile/notesStore.js';
import { buildNoteReminder } from '../schedule/noteReminder.js';
import { createPersonalTime, resolvePersonalTimeId } from '../schedule/personalTime.js';

export interface NoteReminderCandidate {
  sessionId: string;
  personalTime: PersonalTimeInput;
}

/**
 * メモからセッション直前のリマインダー候補を作る（企画書 §5.7「当日の表示」）。
 * カタログに無い・時刻情報が無い・既に同じリマインダーが存在するものは除外する。
 */
export function buildNoteReminderPlan(notes: NotesBySessionId, snapshot: Session[], schedule: Schedule): NoteReminderCandidate[] {
  const snapshotById = new Map(snapshot.map((s) => [s.sessionId, s]));

  return Object.entries(notes)
    .map(([sessionId, text]) => {
      const session = snapshotById.get(sessionId);
      if (!session) return undefined;
      const personalTime = buildNoteReminder(session, text);
      return personalTime ? { sessionId, personalTime } : undefined;
    })
    .filter((r): r is NoteReminderCandidate => Boolean(r))
    .filter((r) => !resolvePersonalTimeId(schedule, r.personalTime));
}

/** 計画済みのリマインダーを実際にCreatePersonalTimeで確保する。作成した件数を返す。 */
export async function applyNoteReminders(client: ApiClient, eventId: string, candidates: NoteReminderCandidate[]): Promise<number> {
  for (const r of candidates) {
    await createPersonalTime(client, eventId, r.personalTime);
  }
  return candidates.length;
}

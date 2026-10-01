import type { Session, PersonalTimeInput } from '../api/types.js';
import { sanitizeForPersonalTime } from './sanitizeText.js';
import { sessionStartUtc, toPersonalTimeDateTime } from './sessionTimeUtc.js';

const LEAD_MINUTES = 15;

/**
 * メモをセッション開始前に表示するための PersonalTimeInput を作る（企画書 §5.7「当日の表示」）。
 * セッション開始時刻の情報が無い場合は undefined を返す。
 */
export function buildNoteReminder(session: Session, note: string): PersonalTimeInput | undefined {
  const start = sessionStartUtc(session);
  if (!start) return undefined;
  const reminderStart = new Date(start.getTime() - LEAD_MINUTES * 60_000);

  return {
    startDateTime: toPersonalTimeDateTime(reminderStart),
    endDateTime: toPersonalTimeDateTime(start),
    title: sanitizeForPersonalTime(`📝 ${session.title}`),
    description: sanitizeForPersonalTime(note),
  };
}

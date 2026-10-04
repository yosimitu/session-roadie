import type { PersonalTime, Session } from '../api/types.js';
import { sessionStartUtc, sessionEndUtc } from '../schedule/sessionTimeUtc.js';
import { blockingPersonalTimes, personalTimeRangeUtc } from '../schedule/blockingPersonalTime.js';

export interface PersonalTimeConflict {
  sessionId: string;
  personalTimeId: string;
  personalTimeTitle: string;
  startDateTime: string; // UTC（PersonalTimeの形式のまま）
  endDateTime: string;
}

/** 予約済みセッションと、利用者が入れた個人予定（基調講演など）との重複を返す */
export function findPersonalTimeConflicts(sessions: Session[], personalTimes: PersonalTime[]): PersonalTimeConflict[] {
  const conflicts: PersonalTimeConflict[] = [];
  for (const pt of blockingPersonalTimes(personalTimes)) {
    const range = personalTimeRangeUtc(pt);
    if (!range) continue;
    for (const s of sessions) {
      const start = sessionStartUtc(s);
      const end = sessionEndUtc(s);
      if (!start || !end) continue;
      if (start < range.end && range.start < end) {
        conflicts.push({
          sessionId: s.sessionId,
          personalTimeId: pt.personalTimeId,
          personalTimeTitle: pt.title,
          startDateTime: pt.startDateTime,
          endDateTime: pt.endDateTime,
        });
      }
    }
  }
  return conflicts;
}

function overlaps(a: Session, b: Session): boolean {
  const aStart = sessionStartUtc(a);
  const aEnd = sessionEndUtc(a);
  const bStart = sessionStartUtc(b);
  const bEnd = sessionEndUtc(b);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart < bEnd && bStart < aEnd;
}

/** 時間的に重なるセッションをグループ化する（企画書 §5.4「諦める判断を支援する」の入力） */
export function findConflicts(sessions: Session[]): Session[][] {
  const groups: Session[][] = [];
  const used = new Set<string>();

  for (let i = 0; i < sessions.length; i += 1) {
    if (used.has(sessions[i].sessionId)) continue;
    const group = [sessions[i]];
    for (let j = i + 1; j < sessions.length; j += 1) {
      if (used.has(sessions[j].sessionId)) continue;
      if (group.some((g) => overlaps(g, sessions[j]))) group.push(sessions[j]);
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g.sessionId));
      groups.push(group);
    }
  }
  return groups;
}

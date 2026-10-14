import type { PersonalTime, Session } from '../api/types.js';
import { sessionStartUtc, sessionEndUtc } from '../schedule/sessionTimeUtc.js';
import { blockingPersonalTimes, personalTimeRangeUtc } from '../schedule/blockingPersonalTime.js';
import { ARRIVAL_BUFFER_MINUTES, getTravelMinutes } from '../schedule/travelTime.js';

/** 予約済みセッションと、利用者自身の個人予定が埋めている時間（Date は sessionStartUtc と同じ基準） */
export interface BusyInterval {
  start: Date;
  end: Date;
  venue?: string; // 個人予定には無い
  label: string;
}

export function busyIntervalsOf(reserved: Session[], personalTimes: PersonalTime[]): BusyInterval[] {
  const intervals: BusyInterval[] = [];
  for (const s of reserved) {
    const start = sessionStartUtc(s);
    const end = sessionEndUtc(s);
    if (start && end) intervals.push({ start, end, venue: s.venue, label: s.abbreviation ?? s.title });
  }
  for (const pt of blockingPersonalTimes(personalTimes)) {
    const range = personalTimeRangeUtc(pt);
    if (range) intervals.push({ ...range, label: pt.title });
  }
  return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * [start, end] のセッションが、埋まっている時間のどれとも重ならず、前後の予約済みセッションとの間に
 * 移動時間（getTravelMinutes）と到着の余裕（開始の10分前までに着かないと席が譲られる）も確保できるか。
 * 個人予定との間には、重ならなければよい（会場が無く、席の取り置きもないため）。
 */
export function fitsAround(start: Date, end: Date, venue: string | undefined, busy: BusyInterval[]): boolean {
  for (const b of busy) {
    const isSession = b.venue !== undefined;
    const travelMinutes = venue && b.venue ? getTravelMinutes(venue, b.venue) : 0;
    const travelMs = (travelMinutes + (isSession ? ARRIVAL_BUFFER_MINUTES : 0)) * 60_000;
    const endsBefore = b.start.getTime() - end.getTime() >= travelMs;
    const startsAfter = start.getTime() - b.end.getTime() >= travelMs;
    if (!endsBefore && !startsAfter) return false;
  }
  return true;
}

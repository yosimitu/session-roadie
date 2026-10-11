import type { SeatAvailability, Session } from '../api/types.js';

// 監視（空席・新着・変更）の判定。副作用を持たない純粋関数だけを置く。
// 空席の判定は seatAvailability の表示が変わったかどうかで、予約できるかどうかは保証しない
// （2026-10-11 の実機では、limited でも sessionFull だった）。

export interface WatchedFields {
  title: string;
  abbreviation?: string;
  seat?: SeatAvailability;
  venue?: string;
  room?: string;
  date?: string;
  time?: string;
  length?: string;
}

export interface WatchState {
  observedAt: string; // ISO 8601
  sessions: Record<string, WatchedFields>;
}

const OPEN_SEATS: ReadonlySet<SeatAvailability> = new Set(['available', 'limited', 'veryLimited', 'walkUp']);

export function isSeatOpen(seat: SeatAvailability | null | undefined): boolean {
  return seat != null && OPEN_SEATS.has(seat);
}

function toFields(s: Session): WatchedFields {
  return {
    title: s.title,
    abbreviation: s.abbreviation,
    seat: s.seatAvailability,
    venue: s.venue,
    room: s.room,
    date: s.sessionTime?.date,
    time: s.sessionTime?.time,
    length: s.sessionTime?.length,
  };
}

export function buildWatchState(sessions: Session[], observedAt: Date): WatchState {
  return {
    observedAt: observedAt.toISOString(),
    sessions: Object.fromEntries(sessions.map((s) => [s.sessionId, toFields(s)])),
  };
}

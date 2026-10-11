import type { SeatAvailability, Session } from '../api/types.js';
import { findRepeats } from '../planning/alternatives.js';

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

export type WatchRole = 'reserved' | 'favorite';

/** 通知・JSON 出力に使う、セッションの要約 */
export interface SessionBrief {
  sessionId: string;
  abbreviation?: string;
  title: string;
  date?: string;
  time?: string;
  venue?: string;
  seat?: SeatAvailability;
}

export type WatchEvent =
  | { kind: 'seatOpened'; session: SessionBrief }
  | { kind: 'altSeatOpened'; session: SessionBrief; forSession: SessionBrief }
  | { kind: 'newMatching'; session: SessionBrief }
  | { kind: 'changedMine'; role: WatchRole; session: SessionBrief; changedFields: string[] }
  | { kind: 'removedMine'; role: WatchRole; session: SessionBrief };

export interface WatchContext {
  reservedIds: ReadonlySet<string>;
  favoriteIds: ReadonlySet<string>;
  /** 新着のうち、プロフィールの条件に合うものだけを返す */
  filterNew: (added: Session[]) => Session[];
}

function brief(s: Session): SessionBrief {
  return {
    sessionId: s.sessionId,
    abbreviation: s.abbreviation,
    title: s.title,
    date: s.sessionTime?.date,
    time: s.sessionTime?.time,
    venue: s.venue,
    seat: s.seatAvailability,
  };
}

/**
 * 前回の観測と今回の全セッションを比べて、知らせるべきイベントを返す。
 * 前回の観測が無い初回は、呼び出し側が基準の保存だけを行い、この関数は呼ばない。
 */
export function detectWatchEvents(previous: WatchState, current: Session[], context: WatchContext): WatchEvent[] {
  const events: WatchEvent[] = [];
  const currentById = new Map(current.map((s) => [s.sessionId, s]));
  const known = (id: string) => id in previous.sessions;
  const opened = (s: Session) =>
    known(s.sessionId) && !isSeatOpen(previous.sessions[s.sessionId]?.seat) && isSeatOpen(s.seatAvailability);

  // お気に入り（未予約）の空席表示
  for (const id of context.favoriteIds) {
    if (context.reservedIds.has(id)) continue;
    const s = currentById.get(id);
    if (s && opened(s)) events.push({ kind: 'seatOpened', session: brief(s) });
  }

  // 満席（unavailable）のお気に入りの再演（-R / -R1 など）に空席表示が出た
  const alreadyAlt = new Set<string>();
  for (const id of context.favoriteIds) {
    if (context.reservedIds.has(id)) continue;
    const fav = currentById.get(id);
    if (!fav || fav.seatAvailability !== 'unavailable') continue;
    for (const repeat of findRepeats(current, fav)) {
      if (context.reservedIds.has(repeat.sessionId) || context.favoriteIds.has(repeat.sessionId)) continue;
      if (alreadyAlt.has(repeat.sessionId) || !opened(repeat)) continue;
      alreadyAlt.add(repeat.sessionId);
      events.push({ kind: 'altSeatOpened', session: brief(repeat), forSession: brief(fav) });
    }
  }

  // プロフィールに合う新着
  const added = current.filter((s) => !known(s.sessionId));
  for (const s of context.filterNew(added)) events.push({ kind: 'newMatching', session: brief(s) });

  return events;
}

import type { PersonalTime, SeatAvailability, Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import { searchCatalog } from '../catalog/search.js';
import { sessionStartUtc, sessionEndUtc, toPersonalTimeDateTime } from '../schedule/sessionTimeUtc.js';
import { ARRIVAL_BUFFER_MINUTES, getTravelMinutes } from '../schedule/travelTime.js';
import { searchDefaultsFromProfile } from './preferences.js';
import { busyIntervalsOf, fitsAround } from './busyIntervals.js';

export const DEFAULT_WITHIN_MINUTES = 90;
export const DEFAULT_QUEUE_LIMIT = 5;
const RECENT_END_MINUTES = 180;

export interface NowGoInput {
  sessions: Session[]; // カタログのスナップショット
  reserved: Session[]; // 予約済み（スナップショットに載っているもの）
  personalTimes: PersonalTime[];
  favoriteIds?: string[];
  profile?: Profile;
  now: Date; // 実際の時刻（sessionStartUtc と同じ基準）
  currentVenue?: string; // 省略時は予約から推定する
  withinMinutes?: number;
  limit?: number;
  /** 満席表示（現地の列に並ぶ候補）の件数。既定 5 */
  queueLimit?: number;
}

export interface NowGoItem {
  sessionId: string;
  abbreviation?: string;
  title: string;
  type?: string;
  level?: string;
  venue?: string;
  room?: string;
  date?: string;
  time?: string;
  length?: string;
  startsInMinutes: number;
  travelMinutes: number;
  seatAvailability?: SeatAvailability;
  isFavorite: boolean;
  notes: string[];
}

export interface NowGoResult {
  nowLocal: string; // 会場の現地時刻 "YYYY-MM-DDTHH:MM:SS"
  currentVenue?: string;
  withinMinutes: number;
  /** 開始の何分前までに部屋に着く必要があるか（予約した席は、これより遅いと譲られる） */
  arrivalBufferMinutes: number;
  items: NowGoItem[];
  /**
   * 満席表示のセッション。公式 FAQ では、各セッションに当日並ぶ人（walk-up）向けの席が一部残されており、
   * 予約できなくても現地の列に並べるとされる。席は保証されない。
   */
  queue: NowGoItem[];
  notes: string[];
}

/** いま開催中の予約、なければ直近（3時間以内）に終わった予約の会場 */
export function inferCurrentVenue(reserved: Session[], now: Date): string | undefined {
  let latestEnded: { end: number; venue: string } | undefined;
  for (const s of reserved) {
    const start = sessionStartUtc(s);
    const end = sessionEndUtc(s);
    if (!start || !end || !s.venue) continue;
    if (start <= now && now <= end) return s.venue;
    if (end < now && now.getTime() - end.getTime() <= RECENT_END_MINUTES * 60_000 && (!latestEnded || end.getTime() > latestEnded.end)) {
      latestEnded = { end: end.getTime(), venue: s.venue };
    }
  }
  return latestEnded?.venue;
}

const SEAT_ORDER: Record<string, number> = { available: 0, limited: 1, veryLimited: 2, walkUp: 3 };
const seatOrder = (seat?: SeatAvailability): number => (seat ? (SEAT_ORDER[seat] ?? 4) : 4);

/**
 * いまから間に合うセッション。開始が「いま＋移動時間」以降で、withinMinutes 以内に始まり、
 * 予約・個人予定と重ならず、前後の予定との間に移動時間が取れるものを返す。満席（unavailable）は除く。
 * 席の空きは保証しない（limited でも満席のことがある）。
 */
export function findSessionsNow(input: NowGoInput): NowGoResult {
  const withinMinutes = input.withinMinutes ?? DEFAULT_WITHIN_MINUTES;
  const currentVenue = input.currentVenue ?? inferCurrentVenue(input.reserved, input.now);
  const favorites = new Set(input.favoriteIds ?? []);
  const reservedIds = new Set(input.reserved.map((s) => s.sessionId));
  const interest = new Set(input.profile?.interestTopics ?? []);
  const busy = busyIntervalsOf(input.reserved, input.personalTimes);
  const notes: string[] = [
    '空席表示は予約できることを保証しません（limited でも満席のことがあります）。',
    `予約した席は、開始の${ARRIVAL_BUFFER_MINUTES}分前までに部屋に着かないと、当日並ぶ人に譲られます。間に合うかの判定には、移動時間に${ARRIVAL_BUFFER_MINUTES}分を足しています。`,
  ];
  if (!currentVenue) notes.push('現在の会場が分からないため、移動時間は見込んでいません（--venue で指定できます）。');

  const filtered = searchCatalog(input.sessions, { ...searchDefaultsFromProfile(input.profile), limit: input.sessions.length }).items;
  const allowed = new Set(filtered.map((i) => i.sessionId));
  const byId = new Map(input.sessions.map((s) => [s.sessionId, s]));

  type Ranked = { item: NowGoItem; keys: number[] };
  const ranked: Ranked[] = [];
  const queued: Ranked[] = [];
  for (const id of allowed) {
    const s = byId.get(id);
    if (!s || reservedIds.has(s.sessionId) || s.isAllDaySession) continue;
    const start = sessionStartUtc(s);
    const end = sessionEndUtc(s);
    if (!start || !end) continue;

    const startsInMinutes = Math.round((start.getTime() - input.now.getTime()) / 60_000);
    const travelMinutes = currentVenue && s.venue ? getTravelMinutes(currentVenue, s.venue) : 0;
    // 開始の ARRIVAL_BUFFER_MINUTES 前までに部屋に着く必要があるので、移動時間にその分を足して間に合うかを見る
    if (startsInMinutes < travelMinutes + ARRIVAL_BUFFER_MINUTES || startsInMinutes > withinMinutes) continue;
    if (!fitsAround(start, end, s.venue, busy)) continue;

    const isFull = s.seatAvailability === 'unavailable';
    const itemNotes: string[] = [];
    const isFavorite = favorites.has(s.sessionId);
    if (isFavorite) itemNotes.push('お気に入り');
    if (isFull) itemNotes.push('満席表示。現地の列（walk-up）に並べば入れる場合があります（席は保証されません。早めに並ぶ前提です）');
    if (s.seatAvailability === 'walkUp') itemNotes.push('walkUp（当日会場で並ぶ形式と思われます。未確認）');
    if (!s.seatAvailability) itemNotes.push('空席表示が不明');
    if (s.isReservable === false) itemNotes.push('予約の対象外（予約できない形式）');
    const matchesInterest = (s.topics ?? []).some((t) => interest.has(t));
    if (matchesInterest) itemNotes.push('関心のあるトピック');

    const item: NowGoItem = {
      sessionId: s.sessionId, abbreviation: s.abbreviation, title: s.title, type: s.type, level: s.level,
      venue: s.venue, room: s.room, date: s.sessionTime?.date, time: s.sessionTime?.time, length: s.sessionTime?.length,
      startsInMinutes, travelMinutes, seatAvailability: s.seatAvailability, isFavorite, notes: itemNotes,
    };
    const keys = [isFavorite ? 0 : 1, matchesInterest ? 0 : 1, seatOrder(s.seatAvailability), startsInMinutes];
    (isFull ? queued : ranked).push({ item, keys });
  }

  const byKeys = (a: Ranked, b: Ranked): number => {
    for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] - b.keys[i];
    return a.item.sessionId.localeCompare(b.item.sessionId);
  };
  ranked.sort(byKeys);
  queued.sort(byKeys);

  return {
    nowLocal: toPersonalTimeDateTime(input.now),
    currentVenue,
    withinMinutes,
    arrivalBufferMinutes: ARRIVAL_BUFFER_MINUTES,
    items: ranked.slice(0, input.limit ?? 10).map((r) => r.item),
    queue: queued.slice(0, input.queueLimit ?? DEFAULT_QUEUE_LIMIT).map((r) => r.item),
    notes,
  };
}

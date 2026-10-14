import type { PersonalTime, SeatAvailability, Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import { searchCatalog } from '../catalog/search.js';
import { sessionStartUtc, sessionEndUtc } from '../schedule/sessionTimeUtc.js';
import { getTravelMinutes } from '../schedule/travelTime.js';
import { baseAbbreviation } from './alternatives.js';
import { searchDefaultsFromProfile } from './preferences.js';
import { busyIntervalsOf, fitsAround, type BusyInterval } from './busyIntervals.js';

export const DEFAULT_DETOURS_PER_DAY = 3;

// トピックごとの関心の強さ: プロフィールで宣言した関心は 3、予約ごとに 2、お気に入りごとに 1 を足す。
// セッションの関心は、そのトピックのうち最も強いもの。小さいものほど「寄り道」にふさわしい。
// トピックは全部で18種類ほどしかなく、関心が全く無いものは残りにくい（2026-10-14 の実データで、完全に関心の外だけに
// 絞ると5日中3日が候補なしになった）。そこで MAX_DETOUR_AFFINITY までは許し、小さい順に並べる。
// 実データで、中核の分野は強さ8〜19になる。
const INTEREST_DECLARED = 3;
const AFFINITY_PER_RESERVED = 2;
const AFFINITY_PER_FAVORITE = 1;
export const MAX_DETOUR_AFFINITY = 3;

export interface DetourInput {
  sessions: Session[]; // カタログのスナップショット
  reserved: Session[];
  personalTimes: PersonalTime[];
  favoriteIds?: string[];
  profile?: Profile;
  dates?: string[]; // 会場の日付 "YYYY-MM-DD"。省略時は予約のある日
  perDay?: number;
}

export interface DetourItem {
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
  seatAvailability?: SeatAvailability;
  topics: string[];
  /** 関心の強さ。0 なら関心の外。大きいほど、似たトピックの予約・お気に入り・宣言した関心が多い */
  affinity: number;
  /** 直前・直後の予定（空き時間に収まる位置の目安） */
  between: { before?: string; after?: string };
}

export interface DetourDay {
  date: string;
  candidates: DetourItem[];
}

export interface DetourResult {
  days: DetourDay[];
  /** 関心の強さが付いているトピックの数 */
  interestTopicCount: number;
  notes: string[];
}

const SEAT_ORDER: Record<string, number> = { available: 0, limited: 1, veryLimited: 2, walkUp: 3 };
const seatOrder = (seat?: SeatAvailability): number => (seat ? (SEAT_ORDER[seat] ?? 4) : 4);

const startMinutesOf = (s: Session): number | undefined => {
  const time = s.sessionTime?.time;
  return time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : undefined;
};

/** 前後の予定との移動時間の合計（短いほど寄り道しやすい） */
function neighbourTravel(start: Date, end: Date, venue: string | undefined, busy: BusyInterval[]): { minutes: number; before?: BusyInterval; after?: BusyInterval } {
  const before = [...busy].reverse().find((b) => b.end <= start);
  const after = busy.find((b) => b.start >= end);
  const leg = (b?: BusyInterval) => (b?.venue && venue ? getTravelMinutes(venue, b.venue) : 0);
  return { minutes: leg(before) + leg(after), before, after };
}

/**
 * 予約の合間に収まる、関心の強さが小さい順のセッションを日ごとに提案する。
 * 関心の強さは、プロフィールの関心トピック・予約・お気に入りのトピックから数える（上の定数を参照）。
 * 予約・個人予定との間に移動時間が取れ、満席でなく、プロフィールのレベル・スポンサー・開始時刻の条件に合うものだけを出す。
 * 並びは決まった順（関心が薄い、空席が多い、形式が予約と違う、移動が短い、時刻が早い）で、ランダムではない。
 */
export function suggestDetours(input: DetourInput): DetourResult {
  const perDay = input.perDay ?? DEFAULT_DETOURS_PER_DAY;
  const notes: string[] = [];
  const dates = input.dates ?? [...new Set(input.reserved.map((s) => s.sessionTime?.date).filter((d): d is string => Boolean(d)))].sort();
  if (dates.length === 0) {
    notes.push('予約のある日がないため、提案する日がありません。日付を指定してください。');
    return { days: [], interestTopicCount: 0, notes };
  }

  const byId = new Map(input.sessions.map((s) => [s.sessionId, s]));
  const favorites = new Set(input.favoriteIds ?? []);
  const reservedIds = new Set(input.reserved.map((s) => s.sessionId));
  const affinityOf = new Map<string, number>();
  const add = (topic: string, n: number) => affinityOf.set(topic, (affinityOf.get(topic) ?? 0) + n);
  for (const t of input.profile?.interestTopics ?? []) add(t, INTEREST_DECLARED);
  for (const s of input.reserved) for (const t of s.topics ?? []) add(t, AFFINITY_PER_RESERVED);
  for (const id of favorites) for (const t of byId.get(id)?.topics ?? []) add(t, AFFINITY_PER_FAVORITE);
  const reservedTypes = new Set(input.reserved.map((s) => s.type).filter((t): t is string => Boolean(t)));
  const busy = busyIntervalsOf(input.reserved, input.personalTimes);
  const earliest = input.profile?.earliestStart;
  const earliestMinutes = earliest ? Number(earliest.slice(0, 2)) * 60 + Number(earliest.slice(3, 5)) : undefined;

  const allowed = new Set(
    searchCatalog(input.sessions, { ...searchDefaultsFromProfile(input.profile), dates, limit: input.sessions.length }).items.map((i) => i.sessionId),
  );

  const days: DetourDay[] = dates.map((date) => {
    const ranked: { item: DetourItem; keys: number[]; base: string }[] = [];
    for (const s of input.sessions) {
      if (!allowed.has(s.sessionId) || s.sessionTime?.date !== date) continue;
      if (reservedIds.has(s.sessionId) || favorites.has(s.sessionId) || s.isAllDaySession || s.seatAvailability === 'unavailable') continue;
      const topics = s.topics ?? [];
      if (topics.length === 0) continue; // トピックが無いと関心の強さを判断できない
      const affinity = Math.max(...topics.map((t) => affinityOf.get(t) ?? 0));
      if (affinity > MAX_DETOUR_AFFINITY) continue; // 中核の分野は寄り道ではない
      const startMinutes = startMinutesOf(s);
      if (earliestMinutes !== undefined && startMinutes !== undefined && startMinutes < earliestMinutes) continue;
      const start = sessionStartUtc(s);
      const end = sessionEndUtc(s);
      if (!start || !end || !fitsAround(start, end, s.venue, busy)) continue;

      const near = neighbourTravel(start, end, s.venue, busy);
      ranked.push({
        base: s.abbreviation ? baseAbbreviation(s.abbreviation) : s.sessionId,
        keys: [affinity, seatOrder(s.seatAvailability), s.type && reservedTypes.has(s.type) ? 1 : 0, near.minutes, startMinutes ?? 0],
        item: {
          sessionId: s.sessionId, abbreviation: s.abbreviation, title: s.title, type: s.type, level: s.level,
          venue: s.venue, room: s.room, date: s.sessionTime?.date, time: s.sessionTime?.time, length: s.sessionTime?.length,
          seatAvailability: s.seatAvailability, topics, affinity,
          between: { ...(near.before ? { before: near.before.label } : {}), ...(near.after ? { after: near.after.label } : {}) },
        },
      });
    }
    ranked.sort((a, b) => {
      for (let i = 0; i < a.keys.length; i++) if (a.keys[i] !== b.keys[i]) return a.keys[i] - b.keys[i];
      return a.item.sessionId.localeCompare(b.item.sessionId);
    });

    // 同じ番号の再演を並べない
    const seenBase = new Set<string>();
    const candidates: DetourItem[] = [];
    for (const r of ranked) {
      if (seenBase.has(r.base)) continue;
      seenBase.add(r.base);
      candidates.push(r.item);
      if (candidates.length >= perDay) break;
    }
    return { date, candidates };
  });

  if (days.every((d) => d.candidates.length === 0)) notes.push('条件に合う寄り道の候補がありません。空き時間が短いか、収まるセッションが残っていません。');
  return { days, interestTopicCount: affinityOf.size, notes };
}

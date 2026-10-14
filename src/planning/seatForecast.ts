import type { SeatAvailability, Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import type { SeatObservation } from '../catalog/seatHistory.js';
import { searchCatalog } from '../catalog/search.js';
import { searchDefaultsFromProfile, datesWithinAttendance } from './preferences.js';

// 空席表示を、埋まり具合の段階（0=available … 3=unavailable）にそろえる。walkUp は別の仕組みなので対象外。
const FILL_RANK: Partial<Record<SeatAvailability, number>> = { available: 0, limited: 1, veryLimited: 2, unavailable: 3 };
const FULL_RANK = 3;
const DAY_MS = 86_400_000;

export const DEFAULT_HORIZON_DAYS = 14;

export type Trend = 'filling' | 'stable' | 'freeing';
export type Confidence = 'low' | 'medium' | 'high';

export interface ForecastItem {
  sessionId: string;
  abbreviation?: string;
  title: string;
  date?: string;
  time?: string;
  venue?: string;
  seatAvailability: SeatAvailability;
  trend: Trend;
  /** 満席になるまでの日数の見込み（filling のときだけ）。段階の進む速さが今後も続く、と仮定した値 */
  daysToFull?: number;
  confidence: Confidence;
  isFavorite: boolean;
  firstSeen: { date: string; seatAvailability: SeatAvailability };
}

export interface ForecastResult {
  observationDates: string[];
  horizonDays: number;
  /** 近いうちに埋まりそうなもの（お気に入りを先に、満席までが近い順） */
  urgent: ForecastItem[];
  /** 動いていない（埋まっていない）うえに、関心のあるトピックのもの */
  hidden: ForecastItem[];
  /** 空席が増えているもの（取消が出ている） */
  freeing: ForecastItem[];
  notes: string[];
}

export interface ForecastInput {
  history: SeatObservation[];
  sessions: Session[]; // 最新のカタログ
  favoriteIds?: string[];
  reservedIds?: string[];
  profile?: Profile;
  eventDates?: string[]; // 開催日。省略時はカタログの日付。プロフィールの参加日で絞るのに使う
  horizonDays?: number;
  limit?: number;
}

const daysBetween = (a: string, b: string): number => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;

function confidenceOf(observations: number, spanDays: number): Confidence {
  if (observations >= 5 && spanDays >= 7) return 'high';
  if (observations >= 3 && spanDays >= 3) return 'medium';
  return 'low';
}

/**
 * 空席表示の履歴から、セッションごとに「埋まる速さ」を出す。最初と最後の観測の段階の差を日数で割る
 * だけの単純な見積もりで、統計的な予測ではない。観測が少ないうちは confidence を low にする。
 * 予約済みと満席のものは対象外。
 */
export function forecastSeats(input: ForecastInput): ForecastResult {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const limit = input.limit ?? 10;
  const favorites = new Set(input.favoriteIds ?? []);
  const reserved = new Set(input.reservedIds ?? []);
  const interest = new Set(input.profile?.interestTopics ?? []);
  const observationDates = input.history.map((o) => o.date);

  const notes: string[] = [
    '空席表示は段階（available / limited / veryLimited / unavailable）で、実際の残席数ではありません。',
    '見積もりは、段階が進む速さが今後も続くと仮定したものです。取消や追加の席で、実際は変わります。',
  ];
  const empty: ForecastResult = { observationDates, horizonDays, urgent: [], hidden: [], freeing: [], notes };
  if (input.history.length < 2 || daysBetween(input.history[0].date, input.history[input.history.length - 1].date) < 1) {
    notes.push('空席表示の履歴が2日分に満たないため、予報を出せません。sync か watch を続けると、履歴がたまります。');
    return empty;
  }

  const eventDates = input.eventDates ?? [...new Set(input.sessions.map((s) => s.sessionTime?.date).filter((d): d is string => Boolean(d)))];
  const allowedDates = datesWithinAttendance(eventDates, input.profile);
  const allowed = new Set(
    searchCatalog(input.sessions, {
      ...searchDefaultsFromProfile(input.profile),
      ...(allowedDates ? { dates: allowedDates } : {}),
      limit: input.sessions.length,
    }).items.map((i) => i.sessionId),
  );

  const urgent: ForecastItem[] = [];
  const hidden: ForecastItem[] = [];
  const freeing: ForecastItem[] = [];

  for (const s of input.sessions) {
    if (reserved.has(s.sessionId) || !s.seatAvailability) continue;
    const nowRank = FILL_RANK[s.seatAvailability];
    if (nowRank === undefined || nowRank >= FULL_RANK) continue;
    const isFavorite = favorites.has(s.sessionId);
    if (!isFavorite && !allowed.has(s.sessionId)) continue;

    const observed = input.history
      .map((o) => ({ date: o.date, seat: o.seats[s.sessionId] }))
      .filter((o): o is { date: string; seat: SeatAvailability } => o.seat !== undefined && FILL_RANK[o.seat] !== undefined);
    if (observed.length < 2) continue;
    const first = observed[0];
    const last = observed[observed.length - 1];
    const spanDays = daysBetween(first.date, last.date);
    if (spanDays < 1) continue;

    const velocity = ((FILL_RANK[last.seat] ?? 0) - (FILL_RANK[first.seat] ?? 0)) / spanDays;
    const trend: Trend = velocity > 0 ? 'filling' : velocity < 0 ? 'freeing' : 'stable';
    const item: ForecastItem = {
      sessionId: s.sessionId, abbreviation: s.abbreviation, title: s.title,
      date: s.sessionTime?.date, time: s.sessionTime?.time, venue: s.venue,
      seatAvailability: s.seatAvailability, trend,
      ...(trend === 'filling' ? { daysToFull: Math.round(((FULL_RANK - nowRank) / velocity) * 10) / 10 } : {}),
      confidence: confidenceOf(observed.length, spanDays), isFavorite,
      firstSeen: { date: first.date, seatAvailability: first.seat },
    };

    if (trend === 'filling' && item.daysToFull !== undefined && item.daysToFull <= horizonDays) urgent.push(item);
    else if (trend === 'freeing') freeing.push(item);
    else if (trend === 'stable' && (s.topics ?? []).some((t) => interest.has(t))) hidden.push(item);
  }

  const byUrgency = (a: ForecastItem, b: ForecastItem) =>
    Number(b.isFavorite) - Number(a.isFavorite) || (a.daysToFull ?? 0) - (b.daysToFull ?? 0) || a.sessionId.localeCompare(b.sessionId);
  const bySeat = (a: ForecastItem, b: ForecastItem) =>
    (FILL_RANK[a.seatAvailability] ?? 0) - (FILL_RANK[b.seatAvailability] ?? 0) || a.sessionId.localeCompare(b.sessionId);

  if (observationDates.length < 3) notes.push(`観測が${observationDates.length}日分だけなので、信頼度は低めです（low）。`);
  return {
    observationDates, horizonDays,
    urgent: urgent.sort(byUrgency).slice(0, limit),
    hidden: hidden.sort(bySeat).slice(0, limit),
    freeing: freeing.sort(bySeat).slice(0, limit),
    notes,
  };
}

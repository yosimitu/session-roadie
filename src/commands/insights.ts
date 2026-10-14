import type { ApiClient } from '../api/client.js';
import type { Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import { loadSnapshot } from '../catalog/store.js';
import { loadSeatHistory } from '../catalog/seatHistory.js';
import { findSessionsNow, type NowGoItem, type NowGoResult } from '../planning/nowGo.js';
import { forecastSeats, type ForecastItem, type ForecastResult } from '../planning/seatForecast.js';
import { suggestDetours, type DetourResult } from '../planning/detour.js';
import { VENUE_UTC_OFFSET_HOURS } from '../schedule/sessionTimeUtc.js';
import { runScheduleStatus } from './scheduleStatus.js';

function requireSnapshot(eventId: string, dataDir: string): Session[] {
  const snapshot = loadSnapshot(eventId, dataDir);
  if (!snapshot) throw new Error(`ローカルスナップショット（${eventId}）がありません。先に sync を実行してください`);
  return snapshot;
}

async function loadContext(client: ApiClient, eventId: string, dataDir: string) {
  const sessions = requireSnapshot(eventId, dataDir);
  const schedule = await runScheduleStatus(client, eventId);
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const reserved = schedule.reserved.map((id) => byId.get(id)).filter((s): s is Session => Boolean(s));
  return { sessions, schedule, reserved };
}

/** 会場の現地時刻 "YYYY-MM-DD HH:MM"（または T 区切り）を、実際の時刻にする。読めなければ undefined */
export function parseVenueLocalTime(text: string): Date | undefined {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  return new Date(Date.UTC(year, month - 1, day, hour + VENUE_UTC_OFFSET_HOURS, minute));
}

export interface NowGoOptions {
  now?: Date;
  venue?: string;
  withinMinutes?: number;
  limit?: number;
}

export async function runNowGo(client: ApiClient, eventId: string, dataDir: string, profile: Profile | undefined, options: NowGoOptions = {}): Promise<NowGoResult> {
  const { sessions, schedule, reserved } = await loadContext(client, eventId, dataDir);
  return findSessionsNow({
    sessions, reserved, personalTimes: schedule.personalTime, favoriteIds: schedule.favorites, profile,
    now: options.now ?? new Date(), currentVenue: options.venue, withinMinutes: options.withinMinutes, limit: options.limit,
  });
}

export interface ForecastOptions {
  horizonDays?: number;
  limit?: number;
}

export async function runSeatForecast(client: ApiClient, eventId: string, dataDir: string, profile: Profile | undefined, options: ForecastOptions = {}): Promise<ForecastResult> {
  const { sessions, schedule } = await loadContext(client, eventId, dataDir);
  const history = loadSeatHistory(eventId, dataDir);
  // watch が sync より新しい観測を持っていることがあるので、最新の観測をカタログの空席表示に上書きする
  const latest = history[history.length - 1]?.seats ?? {};
  const current = sessions.map((s) => (latest[s.sessionId] ? { ...s, seatAvailability: latest[s.sessionId] } : s));
  return forecastSeats({
    history, sessions: current, favoriteIds: schedule.favorites, reservedIds: schedule.reserved, profile,
    horizonDays: options.horizonDays, limit: options.limit,
  });
}

export interface DetourOptions {
  dates?: string[];
  perDay?: number;
}

export async function runDetour(client: ApiClient, eventId: string, dataDir: string, profile: Profile | undefined, options: DetourOptions = {}): Promise<DetourResult> {
  const { sessions, schedule, reserved } = await loadContext(client, eventId, dataDir);
  return suggestDetours({
    sessions, reserved, personalTimes: schedule.personalTime, favoriteIds: schedule.favorites, profile,
    dates: options.dates, perDay: options.perDay,
  });
}

const SEAT_LABEL: Record<string, string> = {
  available: '空席あり', limited: '残りわずか', veryLimited: 'ごくわずか', unavailable: '満席表示', walkUp: 'walkUp',
};
const seatText = (seat?: string): string => (seat ? (SEAT_LABEL[seat] ?? seat) : '空席表示なし');
const label = (s: { abbreviation?: string; sessionId: string; title: string }): string => `${s.abbreviation ?? s.sessionId} ${s.title}`;

function monthDay(date?: string): string {
  const m = date?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : (date ?? '');
}

export function formatNowGo(result: NowGoResult): string[] {
  const lines = [`現地時刻 ${result.nowLocal.replace('T', ' ').slice(0, 16)}${result.currentVenue ? `、現在地 ${result.currentVenue}` : ''}（${result.withinMinutes}分以内に始まるもの）`];
  if (result.items.length === 0) lines.push('いまから間に合うセッション（満席表示でないもの）は見つかりませんでした。');
  const line = (i: NowGoItem) => {
    const travel = i.travelMinutes > 0 ? `、移動${i.travelMinutes}分` : '';
    return `  ${i.time}（あと${i.startsInMinutes}分${travel}）[${seatText(i.seatAvailability)}] ${label(i)} @${i.venue ?? '会場不明'}${i.notes.length ? `  ※${i.notes.join('／')}` : ''}`;
  };
  for (const i of result.items) lines.push(line(i));
  if (result.queue.length > 0) {
    lines.push('満席表示（現地の列に並べば入れる場合があります。席は保証されません）:');
    for (const i of result.queue) lines.push(line(i));
  }
  for (const note of result.notes) lines.push(note);
  return lines;
}

function forecastLine(i: ForecastItem): string {
  const when = [monthDay(i.date), i.time].filter(Boolean).join(' ');
  const fill = i.daysToFull !== undefined ? `満席まで約${i.daysToFull}日` : i.trend === 'freeing' ? '空きが増えています' : '動きなし';
  return `  [${seatText(i.seatAvailability)}] ${label(i)}（${when}）${i.isFavorite ? ' ★お気に入り' : ''} — ${fill}（${i.firstSeen.date} は${seatText(i.firstSeen.seatAvailability)}、信頼度 ${i.confidence}）`;
}

export function formatForecast(result: ForecastResult): string[] {
  const lines = [`観測 ${result.observationDates.length}日分（${result.observationDates[0] ?? '-'} 〜 ${result.observationDates[result.observationDates.length - 1] ?? '-'}）`];
  const section = (title: string, items: ForecastItem[]) => {
    if (items.length === 0) return;
    lines.push(`${title}`);
    for (const i of items) lines.push(forecastLine(i));
  };
  section(`近いうちに埋まりそう（${result.horizonDays}日以内に満席の見込み）:`, result.urgent);
  section('穴場（埋まっておらず、関心のあるトピック）:', result.hidden);
  section('空きが増えている（取消が出ている可能性）:', result.freeing);
  if (result.urgent.length + result.hidden.length + result.freeing.length === 0) lines.push('該当するセッションはありません。');
  for (const note of result.notes) lines.push(note);
  return lines;
}

export function formatDetours(result: DetourResult): string[] {
  const lines: string[] = [];
  for (const day of result.days) {
    lines.push(`${monthDay(day.date)}:`);
    if (day.candidates.length === 0) lines.push('  候補なし');
    for (const c of day.candidates) {
      const between = c.between.before || c.between.after ? `（${[c.between.before, c.between.after].filter(Boolean).join(' と ')} の合間）` : '';
      lines.push(`  ${c.time} [${seatText(c.seatAvailability)}] ${label(c)} @${c.venue ?? '会場不明'}${between}  ※${c.affinity === 0 ? '関心の外' : `関心の強さ${c.affinity}`}: ${c.topics.join(', ')}`);
    }
  }
  for (const note of result.notes) lines.push(note);
  return lines;
}

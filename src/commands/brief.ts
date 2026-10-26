import type { ApiClient } from '../api/client.js';
import type { Schedule, Session } from '../api/types.js';
import { PAGE } from '../reporting/i18n.js';
import { computeDayLoads, type DayLoad } from '../schedule/dayLoad.js';
import { VENUE_UTC_OFFSET_HOURS } from '../schedule/sessionTimeUtc.js';
import { findConflicts } from './conflicts.js';
import { runScheduleStatus } from './scheduleStatus.js';
import { planTravelBlocks } from './travelBlocks.js';

// 1日分の予約の要約（朝に見るもの）。参照専用で、公式の予定は変更しない。
// 日付はすべて会場現地（PST）。

export interface BriefSession {
  sessionId: string;
  start: string; // "HH:MM"
  end?: string;
  label: string; // 略称とタイトル
  venue?: string;
  room?: string;
}

/** 連続する2つの予約の間の移動 */
export interface BriefMove {
  toSessionId: string;
  from: string;
  to: string;
  travelMinutes: number;
  availableMinutes: number;
  neededMinutes: number;
  sufficient: boolean;
}

export interface DayBrief {
  date: string;
  sessions: BriefSession[];
  moves: BriefMove[];
  /** 時間が重なる予約の組（グループ）ごとの略称 */
  overlaps: string[][];
  load: DayLoad;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function addMinutes(hhmm: string, minutes: number): string {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

const labelOf = (s: Session): string => [s.abbreviation, s.title].filter(Boolean).join(' ');

/** 会場現地の「今日」（YYYY-MM-DD） */
export function venueToday(now: Date): string {
  return new Date(now.getTime() - VENUE_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

function reservedOn(schedule: Schedule, snapshot: Session[], date: string): Session[] {
  const byId = new Map(snapshot.map((s) => [s.sessionId, s]));
  return schedule.reserved
    .map((id) => byId.get(id))
    .filter((s): s is Session => s?.sessionTime?.date === date && Boolean(s.sessionTime.time))
    .sort((a, b) => a.sessionTime!.time!.localeCompare(b.sessionTime!.time!));
}

/** その日の予約の要約。予約が無い日は undefined */
export function buildDayBrief(schedule: Schedule, snapshot: Session[], date: string): DayBrief | undefined {
  const day = reservedOn(schedule, snapshot, date);
  if (day.length === 0) return undefined;

  const sessions: BriefSession[] = day.map((s) => {
    const { time, length } = s.sessionTime!;
    return {
      sessionId: s.sessionId,
      start: time!,
      ...(Number.isFinite(Number(length)) && length ? { end: addMinutes(time!, Number(length)) } : {}),
      label: labelOf(s),
      venue: s.venue,
      room: s.room,
    };
  });

  const moves: BriefMove[] = planTravelBlocks(day)
    .filter((b) => b.result.requiredMinutes > 0 || !b.result.sufficient)
    .map((b) => ({
      toSessionId: b.to.sessionId,
      from: b.from.venue ?? '',
      to: b.to.venue ?? '',
      travelMinutes: b.result.requiredMinutes,
      availableMinutes: b.result.availableMinutes,
      neededMinutes: b.result.neededMinutes,
      sufficient: b.result.sufficient,
    }));

  const load = computeDayLoads(day).get(date)!;
  const overlaps = findConflicts(day).map((group) => group.map((s) => s.abbreviation ?? s.sessionId));
  return { date, sessions, moves, overlaps, load };
}

/** 今日（会場現地）以降で、予約のある最初の日。無ければ undefined */
export function nextBriefDate(schedule: Schedule, snapshot: Session[], now: Date): string | undefined {
  const today = venueToday(now);
  const byId = new Map(snapshot.map((s) => [s.sessionId, s]));
  return schedule.reserved
    .map((id) => byId.get(id)?.sessionTime?.date)
    .filter((d): d is string => Boolean(d) && d! >= today)
    .sort()[0];
}

export interface BriefResult {
  date: string;
  /** 会場現地の今日か（false のときは、まだ先の日の予定） */
  isToday: boolean;
  /** その日に予約が無いときは undefined（date を指定した場合のみ起こる） */
  brief?: DayBrief;
}

/** date を指定しなければ、今日以降で予約のある最初の日を使う。今日以降に予約が無ければ undefined */
export function resolveBrief(schedule: Schedule, snapshot: Session[], options: { date?: string; now?: Date } = {}): BriefResult | undefined {
  const now = options.now ?? new Date();
  const date = options.date ?? nextBriefDate(schedule, snapshot, now);
  if (!date) return undefined;
  return { date, isToday: date === venueToday(now), brief: buildDayBrief(schedule, snapshot, date) };
}

export async function runBrief(
  client: ApiClient,
  eventId: string,
  snapshot: Session[],
  options: { date?: string; now?: Date } = {},
): Promise<BriefResult | undefined> {
  return resolveBrief(await runScheduleStatus(client, eventId), snapshot, options);
}

function weekday(date: string): string {
  return PAGE.ja.weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? '';
}

/** コンソールに出す行 */
export function formatBrief(result: BriefResult): string[] {
  const { date, brief } = result;
  const head = `${date}（${weekday(date)}）${result.isToday ? '今日' : ''}の予定`;
  if (!brief) return [`${head}: 予約はありません`];

  const { load } = brief;
  const lines = [
    `${head}: ${brief.sessions.length}件`,
    `  ${PAGE.ja.dayLoad(load.sessionMinutes, load.moves, load.travelMinutes)}`,
  ];
  const moveTo = new Map(brief.moves.map((m) => [m.toSessionId, m]));
  for (const s of brief.sessions) {
    const move = moveTo.get(s.sessionId);
    if (move) {
      const base = `移動 ${move.from} → ${move.to} 約${move.travelMinutes}分（空き ${move.availableMinutes}分）`;
      lines.push(move.sufficient
        ? `      ↓ ${base}`
        : `      ↓ ⚠ ${base}。開始の10分前までに着くには ${move.neededMinutes}分が必要`);
    }
    const place = [s.venue, s.room].filter(Boolean).join(' / ');
    lines.push(`  ${s.start}${s.end ? `–${s.end}` : ''}  ${s.label}${place ? `  [${place}]` : ''}`);
  }
  for (const group of brief.overlaps) lines.push(`  ⚠ 時間が重なる予約: ${group.join(' / ')}`);
  return lines;
}

const NOTIFICATION_MAX_LENGTH = 200;
const NOTIFICATION_TITLE_MAX = 30;

/** デスクトップ通知の本文。最初のセッション、会場移動、警告の件数を1行にする */
export function summarizeBriefForNotification(brief: DayBrief): string {
  const first = brief.sessions[0];
  const label = first.label.length > NOTIFICATION_TITLE_MAX ? `${first.label.slice(0, NOTIFICATION_TITLE_MAX)}…` : first.label;
  const parts = [
    `今日の予定 ${brief.sessions.length}件。最初は ${first.start} ${label}${first.venue ? `（${first.venue}）` : ''}`,
    brief.load.moves > 0 ? `会場移動 ${brief.load.moves}回（約${brief.load.travelMinutes}分）` : '会場移動なし',
  ];
  const short = brief.moves.filter((m) => !m.sufficient).length;
  if (short > 0) parts.push(`⚠ 移動が間に合わない ${short}件`);
  if (brief.overlaps.length > 0) parts.push(`⚠ 時間が重なる予約 ${brief.overlaps.length}組`);
  const text = parts.join('。');
  return text.length > NOTIFICATION_MAX_LENGTH ? text.slice(0, NOTIFICATION_MAX_LENGTH) : text;
}

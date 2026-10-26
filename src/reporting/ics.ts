import type { Schedule, Session } from '../api/types.js';
import { sessionEndUtc, sessionStartUtc } from '../schedule/sessionTimeUtc.js';

// 予約したセッションを、カレンダーアプリに取り込める iCalendar（RFC 5545）にする。参照専用で、公式の予定は変更しない。
// 時刻は UTC（末尾 Z）で書く。取り込んだアプリが、手元のタイムゾーンで表示する。
// 予約していないお気に入りは、options.favorites のときだけ「仮」（TENTATIVE）の予定として含める。個人予定は含めない。

export interface IcsOptions {
  /** 予約していないお気に入りも含める */
  favorites?: boolean;
  now?: Date;
}

export interface IcsResult {
  text: string;
  events: number;
  /** スナップショットに無い、または日時が読めないため出せなかったセッション ID */
  skipped: string[];
}

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

const pad = (n: number): string => String(n).padStart(2, '0');

function formatUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** TEXT 値のエスケープ（バックスラッシュ・セミコロン・カンマ・改行） */
export function escapeIcsText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\n').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
}

/** 1行を75オクテットで折り返す（UTF-8 の文字の途中では切らない。続きの行は先頭に空白1つを付ける） */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf-8');
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1; // 続きの行は先頭の空白の分を引く
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function localRange(s: Session): string | undefined {
  const { date, time, length } = s.sessionTime ?? {};
  if (!date || !time) return undefined;
  const end = Number.isFinite(Number(length)) && length ? ` – ${addMinutes(time, Number(length))}` : '';
  return `${date} ${time}${end}`;
}

function addMinutes(hhmm: string, minutes: number): string {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function eventLines(s: Session, tentative: boolean, stamp: string): string[] | undefined {
  const start = sessionStartUtc(s);
  const end = sessionEndUtc(s);
  if (!start || !end) return undefined;
  const title = [s.abbreviation, s.title].filter(Boolean).join(' ');
  const description = [
    [s.type, s.level].filter(Boolean).join(' / '),
    `現地時刻（PST）: ${localRange(s)}`,
    s.sessionId,
  ].filter(Boolean).join('\n');
  const location = [s.venue, s.room].filter(Boolean).join(' / ');
  return [
    'BEGIN:VEVENT',
    `UID:${s.sessionId}@session-roadie`, // 決まった値にして、取り込み直したときに重複せず更新されるようにする
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeIcsText(tentative ? `☆ ${title}` : title)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    `DESCRIPTION:${escapeIcsText(description)}`,
    `STATUS:${tentative ? 'TENTATIVE' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

export function buildIcs(schedule: Schedule, sessions: Session[], options: IcsOptions = {}): IcsResult {
  const stamp = formatUtc(options.now ?? new Date());
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const reservedIds = new Set(schedule.reserved);
  const targets: { id: string; tentative: boolean }[] = [
    ...schedule.reserved.map((id) => ({ id, tentative: false })),
    ...(options.favorites ? schedule.favorites.filter((id) => !reservedIds.has(id)).map((id) => ({ id, tentative: true })) : []),
  ];

  const events: { startMs: number; lines: string[] }[] = [];
  const skipped: string[] = [];
  for (const { id, tentative } of targets) {
    const s = byId.get(id);
    const lines = s && eventLines(s, tentative, stamp);
    if (!s || !lines) {
      skipped.push(id);
      continue;
    }
    events.push({ startMs: sessionStartUtc(s)!.getTime(), lines });
  }
  events.sort((a, b) => a.startMs - b.startMs);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//session-roadie//re:Roadie//JA',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:re:Invent 2026（re:Roadie）',
    ...events.flatMap((e) => e.lines),
    'END:VCALENDAR',
  ];
  return { text: lines.map(foldIcsLine).join(CRLF) + CRLF, events: events.length, skipped };
}

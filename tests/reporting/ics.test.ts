import { describe, it, expect } from 'vitest';
import { buildIcs, escapeIcsText, foldIcsLine } from '../../src/reporting/ics.js';
import type { Schedule, Session } from '../../src/api/types.js';

const NOW = new Date('2026-10-26T00:00:00Z');

function session(sessionId: string, abbreviation: string, date: string, time: string, length: string, extra: Partial<Session> = {}): Session {
  return { sessionId, abbreviation, title: `Title ${abbreviation}`, venue: 'Venetian', room: 'Level 3 | Room 1', type: 'Breakout session', level: '300 - Advanced', sessionTime: { date, time, length }, ...extra };
}

const schedule = (reserved: string[], favorites: string[] = []): Schedule => ({ reserved, favorites, personalTime: [] });

describe('escapeIcsText', () => {
  it('バックスラッシュ・セミコロン・カンマ・改行をエスケープする', () => {
    expect(escapeIcsText('a,b;c\\d\ne\r\nf')).toBe('a\\,b\\;c\\\\d\\ne\\nf');
  });
});

describe('foldIcsLine', () => {
  it('75オクテットを超える行を、CRLFと空白で折り返す（元に戻せる）', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    expect(physical.every((l) => Buffer.byteLength(l, 'utf-8') <= 75)).toBe(true);
    expect(physical.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('UTF-8 の文字の途中では切らない', () => {
    const line = `SUMMARY:${'あ'.repeat(60)}`;
    const folded = foldIcsLine(line);
    expect(folded.split('\r\n').every((l) => Buffer.byteLength(l, 'utf-8') <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('短い行はそのまま', () => {
    expect(foldIcsLine('BEGIN:VEVENT')).toBe('BEGIN:VEVENT');
  });
});

describe('buildIcs', () => {
  const a = session('a', 'AIM101', '2026-12-02', '10:00', '60', { title: 'Agents, tools; and more' });
  const b = session('b', 'AIM102', '2026-12-01', '08:30', '45');
  const f = session('f', 'AIM200', '2026-12-03', '14:00', '30');

  it('予約したセッションを、会場の現地時刻（PST）を UTC にした予定にする', () => {
    const { text: folded, events, skipped } = buildIcs(schedule(['a']), [a, b, f], { now: NOW });
    const text = folded.replace(/\r\n /g, ''); // 折り返しを戻して検査する
    expect(events).toBe(1);
    expect(skipped).toEqual([]);
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('DTSTART:20261202T180000Z'); // 10:00 PST = 18:00 UTC
    expect(text).toContain('DTEND:20261202T190000Z');
    expect(text).toContain('DTSTAMP:20261026T000000Z');
    expect(text).toContain('UID:a@session-roadie');
    expect(text).toContain('SUMMARY:AIM101 Agents\\, tools\\; and more');
    expect(text).toContain('LOCATION:Venetian / Level 3 | Room 1');
    expect(text).toContain('STATUS:CONFIRMED');
    expect(text).toContain('現地時刻（PST）: 2026-12-02 10:00 – 11:00');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('開始の早い順に並べる', () => {
    const { text } = buildIcs(schedule(['a', 'b']), [a, b], { now: NOW });
    expect(text.indexOf('UID:b@')).toBeLessThan(text.indexOf('UID:a@'));
  });

  it('お気に入りは favorites のときだけ、仮の予定（TENTATIVE・☆つき）として含める。予約済みは重複させない', () => {
    expect(buildIcs(schedule(['a'], ['f']), [a, f], { now: NOW }).events).toBe(1);

    const { text, events } = buildIcs(schedule(['a'], ['a', 'f']), [a, f], { now: NOW, favorites: true });
    expect(events).toBe(2);
    expect(text.match(/UID:a@/g)).toHaveLength(1);
    expect(text).toContain('SUMMARY:☆ AIM200 Title AIM200');
    expect(text).toContain('STATUS:TENTATIVE');
  });

  it('スナップショットに無い、または日時が読めないものは出さずに、IDを返す', () => {
    const noTime: Session = { sessionId: 'n', title: 'no time' };
    const { events, skipped } = buildIcs(schedule(['a', 'ghost', 'n']), [a, noTime], { now: NOW });
    expect(events).toBe(1);
    expect(skipped).toEqual(['ghost', 'n']);
  });

  it('予約が無ければ、予定の無いカレンダーになる', () => {
    const { text, events } = buildIcs(schedule([]), [a], { now: NOW });
    expect(events).toBe(0);
    expect(text).not.toContain('BEGIN:VEVENT');
  });
});

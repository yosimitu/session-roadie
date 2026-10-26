import { describe, it, expect } from 'vitest';
import {
  buildDayBrief, formatBrief, nextBriefDate, resolveBrief, summarizeBriefForNotification, venueToday,
} from '../../src/commands/brief.js';
import type { Schedule, Session } from '../../src/api/types.js';

function session(sessionId: string, abbreviation: string, date: string, time: string, length: string, venue: string): Session {
  return { sessionId, abbreviation, title: `Title ${abbreviation}`, venue, room: 'Room 1', sessionTime: { date, time, length } };
}

const a = session('a', 'AIM101', '2026-12-02', '10:00', '60', 'Venetian');
const b = session('b', 'AIM102', '2026-12-02', '11:10', '60', 'Wynn/Encore'); // 空き10分 < 移動15分＋10分 → 間に合わない
const c = session('c', 'AIM103', '2026-12-02', '13:00', '30', 'Wynn/Encore');
const d = session('d', 'AIM104', '2026-12-04', '09:00', '60', 'MGM Grand');
const snapshot = [a, b, c, d];
const schedule = (reserved: string[]): Schedule => ({ reserved, favorites: [], personalTime: [] });

describe('venueToday', () => {
  it('会場現地（UTC-8）の日付にする', () => {
    expect(venueToday(new Date('2026-12-02T17:00:00Z'))).toBe('2026-12-02'); // 現地 09:00
    expect(venueToday(new Date('2026-12-03T07:59:00Z'))).toBe('2026-12-02'); // 現地 23:59
    expect(venueToday(new Date('2026-12-03T08:00:00Z'))).toBe('2026-12-03'); // 現地 0:00
  });
});

describe('buildDayBrief', () => {
  it('その日の予約を時刻順に並べ、会場移動・合計時間・警告を集計する', () => {
    const brief = buildDayBrief(schedule(['c', 'b', 'a', 'd']), snapshot, '2026-12-02')!;
    expect(brief.sessions.map((s) => s.sessionId)).toEqual(['a', 'b', 'c']);
    expect(brief.sessions[0]).toMatchObject({ start: '10:00', end: '11:00', label: 'AIM101 Title AIM101', venue: 'Venetian' });
    expect(brief.load).toMatchObject({ sessions: 3, sessionMinutes: 150, moves: 1, travelMinutes: 15 });
    expect(brief.moves).toEqual([
      { toSessionId: 'b', from: 'Venetian', to: 'Wynn/Encore', travelMinutes: 15, availableMinutes: 10, neededMinutes: 25, sufficient: false },
    ]);
    expect(brief.overlaps).toEqual([]);
  });

  it('時間が重なる予約を、略称の組にして返す', () => {
    const overlapping = session('o', 'AIM105', '2026-12-02', '10:30', '60', 'Venetian');
    const brief = buildDayBrief(schedule(['a', 'o']), [a, overlapping], '2026-12-02')!;
    expect(brief.overlaps).toHaveLength(1);
    expect(brief.overlaps[0].sort()).toEqual(['AIM101', 'AIM105']);
  });

  it('その日に予約が無ければ undefined', () => {
    expect(buildDayBrief(schedule(['d']), snapshot, '2026-12-02')).toBeUndefined();
    expect(buildDayBrief(schedule([]), snapshot, '2026-12-02')).toBeUndefined();
  });
});

describe('nextBriefDate / resolveBrief', () => {
  const now = new Date('2026-12-02T17:00:00Z'); // 現地 12/02 09:00

  it('今日以降で予約のある最初の日を使う', () => {
    expect(nextBriefDate(schedule(['d', 'a']), snapshot, now)).toBe('2026-12-02');
    expect(nextBriefDate(schedule(['d', 'a']), snapshot, new Date('2026-12-03T17:00:00Z'))).toBe('2026-12-04');
  });

  it('今日以降に予約が無ければ undefined', () => {
    expect(nextBriefDate(schedule(['a']), snapshot, new Date('2026-12-03T17:00:00Z'))).toBeUndefined();
    expect(resolveBrief(schedule(['a']), snapshot, { now: new Date('2026-12-03T17:00:00Z') })).toBeUndefined();
  });

  it('今日の予定かどうかを返す。date を指定して予約が無い日は brief が無い', () => {
    expect(resolveBrief(schedule(['a', 'd']), snapshot, { now })).toMatchObject({ date: '2026-12-02', isToday: true });
    expect(resolveBrief(schedule(['d']), snapshot, { now })).toMatchObject({ date: '2026-12-04', isToday: false });
    const none = resolveBrief(schedule(['a']), snapshot, { date: '2026-12-03', now });
    expect(none).toMatchObject({ date: '2026-12-03', isToday: false });
    expect(none?.brief).toBeUndefined();
  });
});

describe('formatBrief', () => {
  it('予定・移動・合計を出し、間に合わない移動と重なりに ⚠ を付ける', () => {
    const result = resolveBrief(schedule(['a', 'b', 'c']), snapshot, { now: new Date('2026-12-02T17:00:00Z') })!;
    const text = formatBrief(result).join('\n');
    expect(text).toContain('2026-12-02（水）今日の予定: 3件');
    expect(text).toContain('セッション計 2時間30分 / 会場移動 1回（約15分）');
    expect(text).toContain('10:00–11:00  AIM101 Title AIM101  [Venetian / Room 1]');
    expect(text).toContain('⚠ 移動 Venetian → Wynn/Encore 約15分（空き 10分）。開始の10分前までに着くには 25分が必要');
  });

  it('予約が無い日は、その旨を1行で出す', () => {
    const none = resolveBrief(schedule(['a']), snapshot, { date: '2026-12-03', now: new Date('2026-12-02T17:00:00Z') })!;
    expect(formatBrief(none)).toEqual(['2026-12-03（木）の予定: 予約はありません']);
  });
});

describe('summarizeBriefForNotification', () => {
  it('件数・最初のセッション・会場移動・警告を1行にする', () => {
    const brief = buildDayBrief(schedule(['a', 'b', 'c']), snapshot, '2026-12-02')!;
    const text = summarizeBriefForNotification(brief);
    expect(text).toBe('今日の予定 3件。最初は 10:00 AIM101 Title AIM101（Venetian）。会場移動 1回（約15分）。⚠ 移動が間に合わない 1件');
  });

  it('会場移動が無く警告も無ければ、その旨だけ。長いタイトルは切る', () => {
    const long: Session = { ...c, title: 'T'.repeat(100) };
    const brief = buildDayBrief(schedule(['c']), [long], '2026-12-02')!;
    const text = summarizeBriefForNotification(brief);
    expect(text).toContain('会場移動なし');
    expect(text).toContain('…');
    expect(text).not.toContain('⚠');
    expect(text.length).toBeLessThanOrEqual(200);
  });
});

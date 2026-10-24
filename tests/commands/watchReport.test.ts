import { describe, it, expect } from 'vitest';
import {
  formatWatchEvent, formatWatchEvents, formatWatchReport, summarizeForNotification, summarizeNewSessions, notifyDesktop,
} from '../../src/commands/watchReport.js';
import type { WatchEvent, SessionBrief } from '../../src/catalog/watch.js';
import type { WatchResult } from '../../src/commands/watch.js';

const brief = (o: Partial<SessionBrief> = {}): SessionBrief => ({
  sessionId: 's1', abbreviation: 'OPN401-R', title: 'Powertools', date: '2026-12-01', time: '11:30', venue: 'Caesars Forum', seat: 'limited', ...o,
});

describe('formatWatchEvent', () => {
  it('seatOpened は「予約できるとは限りません」と添える', () => {
    const line = formatWatchEvent({ kind: 'seatOpened', session: brief() });
    expect(line).toContain('予約できるとは限りません');
    expect(line).toContain('OPN401-R Powertools');
    expect(line).toContain('12/1 11:30');
    expect(line).toContain('limited');
  });

  it('altSeatOpened は元の満席セッションを示す', () => {
    const line = formatWatchEvent({ kind: 'altSeatOpened', session: brief({ abbreviation: 'OPN401-R1' }), forSession: brief() });
    expect(line).toContain('満席の OPN401-R');
    expect(line).toContain('OPN401-R1');
  });

  it('newMatching / changedMine / removedMine', () => {
    expect(formatWatchEvent({ kind: 'newMatching', session: brief() })).toContain('新着');
    expect(formatWatchEvent({ kind: 'changedMine', role: 'reserved', session: brief(), changedFields: ['venue', 'sessionTime'] }))
      .toMatch(/変更（予約）.*venue, sessionTime/);
    expect(formatWatchEvent({ kind: 'removedMine', role: 'favorite', session: brief() })).toContain('取消（お気に入り）');
  });

  it('日時や会場が無くても落ちない', () => {
    const line = formatWatchEvent({ kind: 'newMatching', session: { sessionId: 'x', title: 'T' } });
    expect(line).toContain('x T');
  });
});

describe('formatWatchReport', () => {
  const stamp = '12:00:00';
  it('カタログが空のときは、状態を更新しないことを伝える', () => {
    const r: WatchResult = { status: 'empty', sessionCount: 0, events: [] };
    expect(formatWatchReport(r, stamp).join('\n')).toContain('カタログが空');
  });
  it('件数が大きく減ったときは、状態を更新しないことを伝える', () => {
    const r: WatchResult = { status: 'shrunk', sessionCount: 4, events: [] };
    expect(formatWatchReport(r, stamp)).toEqual([
      '[12:00:00] 取得件数が前回の半分未満です（4件）。部分的な応答の可能性があるため、状態は更新しません。',
    ]);
  });
  it('初回は基準を保存したことを伝える', () => {
    const r: WatchResult = { status: 'baseline', sessionCount: 2194, events: [] };
    expect(formatWatchReport(r, stamp).join('\n')).toContain('基準を保存');
  });
  it('変化が無いときと、あるとき', () => {
    expect(formatWatchReport({ status: 'checked', sessionCount: 10, events: [] }, stamp).join('\n')).toContain('変化はありません');
    const events: WatchEvent[] = [{ kind: 'newMatching', session: brief() }];
    const lines = formatWatchReport({ status: 'checked', sessionCount: 10, events }, stamp);
    expect(lines[0]).toContain('1件の変化');
    expect(lines.slice(1).join('\n')).toContain('新着');
  });
});

describe('summarizeForNotification', () => {
  it('1件ならそのまま、複数なら「ほかN件」を付ける', () => {
    expect(summarizeForNotification(['a'])).toBe('a');
    expect(summarizeForNotification(['a', 'b', 'c'])).toBe('a ほか2件');
  });
  it('長い文言は200文字に切る', () => {
    expect(summarizeForNotification(['x'.repeat(500)]).length).toBeLessThanOrEqual(200);
  });
});

describe('notifyDesktop', () => {
  it('macOSでは osascript を、メッセージと題を引数で渡して呼ぶ（文字列に埋め込まない）', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const ok = await notifyDesktop('題名', '本文 "quote" \\', { platform: 'darwin', run: async (file, args) => { calls.push({ file, args }); } });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('osascript');
    expect(calls[0].args.slice(-2)).toEqual(['本文 "quote" \\', '題名']);
    expect(calls[0].args.join(' ')).toContain('display notification (item 1 of argv) with title (item 2 of argv)');
  });
  it('macOS以外では何もしない', async () => {
    let called = false;
    const ok = await notifyDesktop('t', 'm', { platform: 'win32', run: async () => { called = true; } });
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('summarizeNewSessions', () => {
  const sess = (id: string, time: string) => brief({ sessionId: id, abbreviation: id, title: `T-${id}`, time });
  it('新着が無ければ null（基準の保存のときも）', () => {
    expect(summarizeNewSessions({ status: 'checked', sessionCount: 1, events: [], newSessions: [] })).toBeNull();
    expect(summarizeNewSessions({ status: 'baseline', sessionCount: 1, events: [] })).toBeNull();
  });
  it('件数と上位3件を出し、プロフィールに合うものを先にする', () => {
    const newSessions = [sess('A', '08:00'), sess('B', '09:00'), sess('C', '10:00'), sess('D', '11:00'), sess('E', '12:00')];
    const events: WatchEvent[] = [{ kind: 'newMatching', session: sess('E', '12:00') }];
    expect(summarizeNewSessions({ status: 'checked', sessionCount: 9, events, newSessions }))
      .toBe('新着5件: E T-E / A T-A / B T-B ほか2件');
  });
  it('スポンサー枠は上位から外し、長いタイトルは省略しても「ほかN件」が残る', () => {
    const long = brief({ sessionId: 'L', abbreviation: 'L1', title: 'x'.repeat(100), time: '09:00' });
    const spons = brief({ sessionId: 'S', abbreviation: 'S1-S', title: 'Sponsored', time: '07:00' });
    const newSessions = [spons, long, sess('B', '10:00'), sess('C', '11:00'), sess('D', '12:00')];
    const text = summarizeNewSessions({ status: 'checked', sessionCount: 9, events: [], newSessions })!;
    expect(text).toBe(`新着5件: L1 ${'x'.repeat(40)}… / B T-B / C T-C ほか2件`);
  });
});

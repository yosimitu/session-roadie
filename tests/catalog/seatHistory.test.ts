import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../../src/api/types.js';
import { saveSnapshot } from '../../src/catalog/store.js';
import { loadSeatHistory, recordSeatHistory } from '../../src/catalog/seatHistory.js';

const s = (id: string, seat?: Session['seatAvailability']): Session => ({ sessionId: id, title: id, ...(seat ? { seatAvailability: seat } : {}) });

describe('seatHistory', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'roadie-seat-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('日付別スナップショットのうち、空席表示のあるものを古い順に読む', () => {
    saveSnapshot('e', [s('a'), s('b')], dir, '2026-10-01'); // 空席表示なし → 含めない
    saveSnapshot('e', [s('a', 'available'), s('b', 'limited')], dir, '2026-10-07');
    saveSnapshot('e', [s('a', 'limited'), s('b', 'unavailable')], dir, '2026-10-13');
    expect(loadSeatHistory('e', dir)).toEqual([
      { date: '2026-10-07', seats: { a: 'available', b: 'limited' } },
      { date: '2026-10-13', seats: { a: 'limited', b: 'unavailable' } },
    ]);
  });

  it('記録した履歴を読み込み、同じ日の再記録は上書きし、スナップショットと日付がかぶれば履歴ファイルを優先する', () => {
    saveSnapshot('e', [s('a', 'available')], dir, '2026-10-07');
    recordSeatHistory('e', [s('a', 'veryLimited')], dir, '2026-10-07');
    recordSeatHistory('e', [s('a', 'limited')], dir, '2026-10-08');
    recordSeatHistory('e', [s('a', 'unavailable')], dir, '2026-10-08');
    expect(loadSeatHistory('e', dir)).toEqual([
      { date: '2026-10-07', seats: { a: 'veryLimited' } },
      { date: '2026-10-08', seats: { a: 'unavailable' } },
    ]);
  });

  it('空席表示が1件もないときは履歴を書かない', () => {
    recordSeatHistory('e', [s('a')], dir, '2026-10-07');
    expect(loadSeatHistory('e', dir)).toEqual([]);
  });

  it('壊れた履歴ファイルは無視する', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'seat-history-e.json'), '{broken');
    recordSeatHistory('e', [s('a', 'limited')], dir, '2026-10-08');
    expect(JSON.parse(readFileSync(join(dir, 'seat-history-e.json'), 'utf-8'))).toEqual({ '2026-10-08': { a: 'limited' } });
  });

  it('eventId に不正な文字があれば拒否する', () => {
    expect(() => recordSeatHistory('../x', [s('a', 'limited')], dir, '2026-10-08')).toThrow();
  });
});

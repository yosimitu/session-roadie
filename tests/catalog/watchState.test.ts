import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWatchState, saveWatchState } from '../../src/catalog/watchState.js';
import type { WatchState } from '../../src/catalog/watch.js';

describe('watchState', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'roadie-watch-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const state: WatchState = { observedAt: '2026-10-11T12:00:00.000Z', sessions: { s1: { title: 'A', seat: 'limited' } } };

  it('保存した状態を読み戻せる', () => {
    saveWatchState('reinvent2026', state, dir);
    expect(loadWatchState('reinvent2026', dir)).toEqual(state);
  });

  it('ファイルが無ければundefined（初回）', () => {
    expect(loadWatchState('reinvent2026', dir)).toBeUndefined();
  });

  it('壊れたファイルはundefined（基準を取り直す）', () => {
    writeFileSync(join(dir, 'watch-state-reinvent2026.json'), '{not json');
    expect(loadWatchState('reinvent2026', dir)).toBeUndefined();
    writeFileSync(join(dir, 'watch-state-reinvent2026.json'), JSON.stringify({ observedAt: 1 }));
    expect(loadWatchState('reinvent2026', dir)).toBeUndefined();
  });

  it('イベントIDごとに別ファイル', () => {
    saveWatchState('reinvent2026', state, dir);
    expect(loadWatchState('other', dir)).toBeUndefined();
  });
});

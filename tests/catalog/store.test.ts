import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, loadSnapshot } from '../../src/catalog/store.js';
import type { Session } from '../../src/api/types.js';

describe('catalog snapshot store', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-catalog-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('保存したスナップショットを読み戻せる', () => {
    const sessions: Session[] = [{ sessionId: 's1', title: 'Test' }];
    saveSnapshot('reinvent2026', sessions, dir);
    expect(loadSnapshot('reinvent2026', dir)).toEqual(sessions);
  });

  it('存在しないイベントはundefinedを返す（帰国後もイベントがListEventsから消えて良い設計）', () => {
    expect(loadSnapshot('unknown-event', dir)).toBeUndefined();
  });
});

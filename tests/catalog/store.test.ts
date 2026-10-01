import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot, loadSnapshot, loadSnapshotByDate, listSnapshotDates } from '../../src/catalog/store.js';
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

  it('日付を指定して保存すると、その日付のスナップショットとしても読み戻せる（1週間前等との比較用の履歴）', () => {
    const sessions: Session[] = [{ sessionId: 's1', title: 'Test' }];
    saveSnapshot('reinvent2026', sessions, dir, '2026-09-28');
    expect(loadSnapshotByDate('reinvent2026', dir, '2026-09-28')).toEqual(sessions);
  });

  it('指定日のスナップショットが無ければundefinedを返す', () => {
    expect(loadSnapshotByDate('reinvent2026', dir, '2026-09-20')).toBeUndefined();
  });

  it('同じ日に複数回保存しても、その日の最新内容で上書きされる', () => {
    saveSnapshot('reinvent2026', [{ sessionId: 's1', title: 'A' }], dir, '2026-09-28');
    saveSnapshot('reinvent2026', [{ sessionId: 's1', title: 'B' }], dir, '2026-09-28');
    expect(loadSnapshotByDate('reinvent2026', dir, '2026-09-28')).toEqual([{ sessionId: 's1', title: 'B' }]);
  });

  it('listSnapshotDatesは保存済みの日付を新しい順で返す', () => {
    saveSnapshot('reinvent2026', [], dir, '2026-09-24');
    saveSnapshot('reinvent2026', [], dir, '2026-10-01');
    saveSnapshot('reinvent2026', [], dir, '2026-09-28');
    expect(listSnapshotDates('reinvent2026', dir)).toEqual(['2026-10-01', '2026-09-28', '2026-09-24']);
  });

  it('listSnapshotDatesはディレクトリが無ければ空配列を返す', () => {
    expect(listSnapshotDates('reinvent2026', join(dir, 'missing'))).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync, runSyncSince } from '../../src/commands/sync.js';
import { saveSnapshot, loadSnapshot } from '../../src/catalog/store.js';
import type { ApiClient } from '../../src/api/client.js';

describe('runSync', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-sync-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('初回実行はスナップショットが無いので全件addedになる', async () => {
    const get = async () => ({ items: [{ sessionId: 's1', title: 'A' }], totalCount: 1 });
    const client = { get } as unknown as ApiClient;

    const diff = await runSync(client, 'reinvent2026', dir);

    expect(diff.added.map((s) => s.sessionId)).toEqual(['s1']);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('2回目の実行では前回保存したスナップショットとの差分になる', async () => {
    let call = 0;
    const get = async () => {
      call += 1;
      if (call === 1) return { items: [{ sessionId: 's1', title: 'A', venue: 'Venetian' }], totalCount: 1 };
      return { items: [{ sessionId: 's1', title: 'A', venue: 'Wynn' }], totalCount: 1 };
    };
    const client = { get } as unknown as ApiClient;

    await runSync(client, 'reinvent2026', dir);
    const diff = await runSync(client, 'reinvent2026', dir);

    expect(diff.added).toEqual([]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].sessionId).toBe('s1');
  });
});

describe('runSyncSince', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-sync-since-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('指定日のスナップショットと現在のカタログの差分を返す（ここ一週間の新着確認用）', async () => {
    saveSnapshot('reinvent2026', [{ sessionId: 's1', title: 'A' }], dir, '2026-09-24');
    const get = async () => ({ items: [{ sessionId: 's1', title: 'A' }, { sessionId: 's2', title: 'B' }], totalCount: 2 });
    const client = { get } as unknown as ApiClient;

    const result = await runSyncSince(client, 'reinvent2026', dir, '2026-09-24');

    expect(result.diff.added.map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('指定日のスナップショットが無ければ、利用可能な日付一覧つきで例外を投げる', async () => {
    saveSnapshot('reinvent2026', [], dir, '2026-09-28');
    const get = async () => ({ items: [], totalCount: 0 });
    const client = { get } as unknown as ApiClient;

    await expect(runSyncSince(client, 'reinvent2026', dir, '2026-09-20')).rejects.toThrow(/2026-09-28/);
  });

  it('比較先の日付が無く例外を投げる場合でも、取得した最新カタログは保存し直す', async () => {
    const get = async () => ({ items: [{ sessionId: 's1', title: 'A' }], totalCount: 1 });
    const client = { get } as unknown as ApiClient;

    await expect(runSyncSince(client, 'reinvent2026', dir, '2026-09-20')).rejects.toThrow();

    expect(loadSnapshot('reinvent2026', dir)).toEqual([{ sessionId: 's1', title: 'A' }]);
  });
});

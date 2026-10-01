import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../../src/commands/sync.js';
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

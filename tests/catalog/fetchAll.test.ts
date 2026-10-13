import { describe, it, expect, vi } from 'vitest';
import { fetchAllSessions } from '../../src/catalog/fetchAll.js';
import type { ApiClient } from '../../src/api/client.js';

describe('fetchAllSessions', () => {
  it('nextTokenが無くなるまでページングして全件を返す', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ items: [{ sessionId: 'a', title: 'A' }], totalCount: 2, nextToken: 't1' })
      .mockResolvedValueOnce({ items: [{ sessionId: 'b', title: 'B' }], totalCount: 2 });
    const client = { get } as unknown as ApiClient;

    const sessions = await fetchAllSessions(client, 'reinvent2026');

    expect(sessions.map((s) => s.sessionId)).toEqual(['a', 'b']);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain('nextToken=t1');
  });

  it('件数がtotalCountと一致すれば警告しない', async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [{ sessionId: 'a', title: 'A' }], totalCount: 1 });
    const warn = vi.fn();

    await fetchAllSessions({ get } as unknown as ApiClient, 'reinvent2026', warn);

    expect(warn).not.toHaveBeenCalled();
  });

  it('件数がtotalCountと違えば警告するが、取得できた分は返す', async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [{ sessionId: 'a', title: 'A' }], totalCount: 3 });
    const warn = vi.fn();

    const sessions = await fetchAllSessions({ get } as unknown as ApiClient, 'reinvent2026', warn);

    expect(sessions).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('1件');
    expect(warn.mock.calls[0][0]).toContain('3件');
  });

  it('totalCountが無い応答では警告しない', async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [{ sessionId: 'a', title: 'A' }] });
    const warn = vi.fn();

    await fetchAllSessions({ get } as unknown as ApiClient, 'reinvent2026', warn);

    expect(warn).not.toHaveBeenCalled();
  });
});

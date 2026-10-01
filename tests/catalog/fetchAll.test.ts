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
});

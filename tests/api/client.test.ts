import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../../src/api/client.js';

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GETは Authorization ヘッダなしでも呼び出せる（公開カタログ想定）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], totalCount: 0 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => undefined });
    const result = await client.get('/v1/events/reinvent2026/sessions');
    expect(result).toEqual({ items: [], totalCount: 0 });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('トークンがあればAuthorizationヘッダを付ける', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => 'tok123' });
    await client.get('/v1/events/reinvent2026/schedule');
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('404は例外にせずnullを返す（削除済みの整合として扱う）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => 'tok123' });
    const result = await client.deleteExpectNotFoundOk('/v1/events/reinvent2026/personal-time/abc');
    expect(result).toBe('alreadyGone');
  });
});

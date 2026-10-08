import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError } from '../../src/api/client.js';

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
    const result = await client.get('/v1/events/reinvent2026/sessions', 'ListSessions');
    expect(result).toEqual({ items: [], totalCount: 0 });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('トークンがあればAuthorizationヘッダを付ける', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => 'tok123' });
    await client.get('/v1/events/reinvent2026/schedule', 'GetSchedule');
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('404は例外にせずnullを返す（削除済みの整合として扱う）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => 'tok123' });
    const result = await client.deleteExpectNotFoundOk('/v1/events/reinvent2026/personal-time/abc', 'DeletePersonalTime');
    expect(result).toBe('alreadyGone');
  });

  it('429はRetry-Afterを尊重して自動リトライし、成功すれば結果を返す', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => undefined });

    const result = await client.get('/v1/events/reinvent2026/schedule', 'GetSchedule');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429以外の失敗はApiErrorとして投げ、リトライしない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'bad' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => undefined });

    await expect(client.get('/v1/events/reinvent2026/schedule', 'GetSchedule')).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('postJsonは204（2026-10-01実機確認: CreatePersonalTime等はボディ無しで返る）を例外にせずundefinedを返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => undefined });

    const result = await client.postJson('/v1/events/reinvent2026/personal-time', {}, 'CreatePersonalTime');

    expect(result).toBeUndefined();
  });

  it('失敗時のApiErrorにstatus・operation・bodyが載り、messageにoperationが含まれる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'not open' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => 'tok123' });

    const err = await client
      .postJson('/v1/events/reinvent2026/reservations', { sessionIds: ['s1'] }, 'ReserveSessions')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(409);
    expect(apiErr.operation).toBe('ReserveSessions');
    expect(apiErr.body).toEqual({ message: 'not open' });
    expect(apiErr.message).toBe('API error 409 (ReserveSessions)');
  });

  it('429がリトライ上限まで続いたら、operation付きのApiError(429)を投げる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => undefined });

    const err = await client.get('/v1/events/reinvent2026/schedule', 'GetSchedule').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).operation).toBe('GetSchedule');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('deleteExpectNotFoundOkの404以外の失敗もoperation付きのApiErrorになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'boom' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ getAccessToken: () => 'tok123' });

    const err = await client
      .deleteExpectNotFoundOk('/v1/events/reinvent2026/reservations/s1', 'CancelReservation')
      .catch((e: unknown) => e);

    expect((err as ApiError).operation).toBe('CancelReservation');
    expect((err as ApiError).body).toEqual({ message: 'boom' });
  });
});

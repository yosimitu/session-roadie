import { describe, it, expect, vi } from 'vitest';
import {
  reserveSessions,
  cancelReservation,
  associateFavorites,
  disassociateFavorite,
} from '../../src/schedule/writes.js';
import type { ApiClient } from '../../src/api/client.js';
import type { BulkResult } from '../../src/api/types.js';

describe('schedule writes', () => {
  it('reserveSessions は BulkResult をそのまま返す（failedを握りつぶさない）', async () => {
    const result: BulkResult = { successful: ['s1'], failed: [{ sessionId: 's2', code: 'sessionFull' }] };
    const postJson = vi.fn().mockResolvedValue(result);
    const client = { postJson } as unknown as ApiClient;

    const got = await reserveSessions(client, 'reinvent2026', ['s1', 's2']);

    expect(got).toEqual(result);
    expect(postJson).toHaveBeenCalledWith(
      '/v1/events/reinvent2026/schedule/reservations',
      { sessionIds: ['s1', 's2'] },
    );
  });

  it('空配列を渡したときはAPIを呼ばずに空のBulkResultを返す', async () => {
    const postJson = vi.fn();
    const client = { postJson } as unknown as ApiClient;

    const got = await reserveSessions(client, 'reinvent2026', []);

    expect(got).toEqual({ successful: [], failed: [] });
    expect(postJson).not.toHaveBeenCalled();
  });

  it('cancelReservation は404を成功（既にキャンセル済み）として扱う', async () => {
    const deleteExpectNotFoundOk = vi.fn().mockResolvedValue('alreadyGone');
    const client = { deleteExpectNotFoundOk } as unknown as ApiClient;

    const status = await cancelReservation(client, 'reinvent2026', 's1');

    expect(status).toBe('alreadyGone');
    expect(deleteExpectNotFoundOk).toHaveBeenCalledWith(
      '/v1/events/reinvent2026/schedule/reservations/s1',
    );
  });

  it('associateFavorites は BulkResult をそのまま返す', async () => {
    const result: BulkResult = { successful: ['s1'], failed: [] };
    const postJson = vi.fn().mockResolvedValue(result);
    const client = { postJson } as unknown as ApiClient;

    const got = await associateFavorites(client, 'reinvent2026', ['s1']);

    expect(got).toEqual(result);
    expect(postJson).toHaveBeenCalledWith(
      '/v1/events/reinvent2026/schedule/favorites',
      { sessionIds: ['s1'] },
    );
  });

  it('disassociateFavorite は404を成功として扱う', async () => {
    const deleteExpectNotFoundOk = vi.fn().mockResolvedValue('deleted');
    const client = { deleteExpectNotFoundOk } as unknown as ApiClient;

    const status = await disassociateFavorite(client, 'reinvent2026', 's1');

    expect(status).toBe('deleted');
    expect(deleteExpectNotFoundOk).toHaveBeenCalledWith(
      '/v1/events/reinvent2026/schedule/favorites/s1',
    );
  });
});

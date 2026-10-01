import { describe, it, expect, vi } from 'vitest';
import { executeReconcilePlan } from '../../src/commands/applyPlan.js';
import type { ApiClient } from '../../src/api/client.js';
import type { BulkResult } from '../../src/api/types.js';

describe('executeReconcilePlan', () => {
  it('toReserve/toFavoriteはBulk APIで、toCancelReservation/toUnfavoriteは1件ずつ実行する', async () => {
    const reserveResult: BulkResult = { successful: ['s1'], failed: [] };
    const favoriteResult: BulkResult = { successful: ['s3'], failed: [] };
    const postJson = vi.fn()
      .mockResolvedValueOnce({ result: reserveResult })
      .mockResolvedValueOnce({ result: favoriteResult });
    const deleteExpectNotFoundOk = vi.fn()
      .mockResolvedValueOnce('deleted')
      .mockResolvedValueOnce('alreadyGone');
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = {
      toReserve: ['s1'],
      toCancelReservation: ['s2'],
      toFavorite: ['s3'],
      toUnfavorite: ['s4'],
    };

    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(result.reserve).toEqual(reserveResult);
    expect(result.favorite).toEqual(favoriteResult);
    expect(result.cancelReservation).toEqual([{ sessionId: 's2', status: 'deleted' }]);
    expect(result.unfavorite).toEqual([{ sessionId: 's4', status: 'alreadyGone' }]);
  });

  it('何も差分が無ければAPIを一切呼ばない', async () => {
    const postJson = vi.fn();
    const deleteExpectNotFoundOk = vi.fn();
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = { toReserve: [], toCancelReservation: [], toFavorite: [], toUnfavorite: [] };
    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(postJson).not.toHaveBeenCalled();
    expect(deleteExpectNotFoundOk).not.toHaveBeenCalled();
    expect(result.cancelReservation).toEqual([]);
    expect(result.unfavorite).toEqual([]);
  });
});

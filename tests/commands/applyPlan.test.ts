import { describe, it, expect, vi } from 'vitest';
import { executeReconcilePlan, verifyAfterApply, hasApplyFailure, type ApplyResult } from '../../src/commands/applyPlan.js';
import { ApiClient, ApiError } from '../../src/api/client.js';
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

    expect(result.reserve).toEqual({ ok: true, value: reserveResult });
    expect(result.favorite).toEqual({ ok: true, value: favoriteResult });
    expect(result.cancelReservation).toEqual({ ok: true, value: [{ sessionId: 's2', status: 'deleted' }] });
    expect(result.unfavorite).toEqual({ ok: true, value: [{ sessionId: 's4', status: 'alreadyGone' }] });
  });

  it('何も差分が無ければAPIを一切呼ばず、全工程が空のok:trueになる', async () => {
    const postJson = vi.fn();
    const deleteExpectNotFoundOk = vi.fn();
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = { toReserve: [], toCancelReservation: [], toFavorite: [], toUnfavorite: [] };
    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(postJson).not.toHaveBeenCalled();
    expect(deleteExpectNotFoundOk).not.toHaveBeenCalled();
    expect(result.reserve).toEqual({ ok: true, value: { successful: [], failed: [] } });
    expect(result.favorite).toEqual({ ok: true, value: { successful: [], failed: [] } });
    expect(result.cancelReservation).toEqual({ ok: true, value: [] });
    expect(result.unfavorite).toEqual({ ok: true, value: [] });
  });

  it('予約が409(notOpenYet)でも、お気に入りなど他の工程は実行される', async () => {
    const favoriteResult: BulkResult = { successful: ['s3'], failed: [] };
    const postJson = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, { message: 'not open' }, undefined, 'ReserveSessions'))
      .mockResolvedValueOnce({ result: favoriteResult });
    const deleteExpectNotFoundOk = vi.fn().mockResolvedValue('deleted');
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = { toReserve: ['s1'], toCancelReservation: [], toFavorite: ['s3'], toUnfavorite: ['s4'] };
    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(result.reserve).toMatchObject({ ok: false, error: { kind: 'notOpenYet', status: 409 } });
    expect(result.favorite).toEqual({ ok: true, value: favoriteResult });
    expect(result.unfavorite).toEqual({ ok: true, value: [{ sessionId: 's4', status: 'deleted' }] });
  });

  it('401(authExpired)が出たら以降の工程は実行せず、未実行として返す', async () => {
    const postJson = vi.fn().mockRejectedValueOnce(new ApiError(401, undefined, undefined, 'ReserveSessions'));
    const deleteExpectNotFoundOk = vi.fn();
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = { toReserve: ['s1'], toCancelReservation: ['s2'], toFavorite: ['s3'], toUnfavorite: ['s4'] };
    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(result.reserve).toMatchObject({ ok: false, error: { kind: 'authExpired' } });
    expect(result.favorite).toEqual({ ok: false, skipped: true });
    expect(result.cancelReservation).toEqual({ ok: true, value: [{ sessionId: 's2', skipped: true }] });
    expect(result.unfavorite).toEqual({ ok: true, value: [{ sessionId: 's4', skipped: true }] });
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(deleteExpectNotFoundOk).not.toHaveBeenCalled();
  });

  it('取消が1件失敗しても残りを続行し、失敗した件にだけerrorが付く', async () => {
    const postJson = vi.fn();
    const deleteExpectNotFoundOk = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, { message: 'boom' }, undefined, 'CancelReservation'))
      .mockResolvedValueOnce('deleted');
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = { toReserve: [], toCancelReservation: ['s2', 's5'], toFavorite: [], toUnfavorite: [] };
    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(result.cancelReservation).toEqual({
      ok: true,
      value: [
        { sessionId: 's2', error: expect.objectContaining({ kind: 'unknown', status: 500 }) },
        { sessionId: 's5', status: 'deleted' },
      ],
    });
  });

  it('取消の途中で401が出たら、その件以降は未実行になり、次の工程もスキップされる', async () => {
    const postJson = vi.fn();
    const deleteExpectNotFoundOk = vi.fn()
      .mockResolvedValueOnce('deleted')
      .mockRejectedValueOnce(new ApiError(401, undefined, undefined, 'CancelReservation'));
    const client = { postJson, deleteExpectNotFoundOk } as unknown as ApiClient;

    const plan = { toReserve: [], toCancelReservation: ['s1', 's2', 's3'], toFavorite: [], toUnfavorite: ['s4'] };
    const result = await executeReconcilePlan(client, 'reinvent2026', plan);

    expect(result.cancelReservation).toEqual({
      ok: true,
      value: [
        { sessionId: 's1', status: 'deleted' },
        { sessionId: 's2', error: expect.objectContaining({ kind: 'authExpired' }) },
        { sessionId: 's3', skipped: true },
      ],
    });
    expect(result.unfavorite).toEqual({ ok: true, value: [{ sessionId: 's4', skipped: true }] });
    expect(deleteExpectNotFoundOk).toHaveBeenCalledTimes(2);
  });
});

describe('verifyAfterApply', () => {
  it('実行後のスケジュールを取り直し、残っている差分をremainingPlanで返す', async () => {
    const get = vi.fn().mockResolvedValue({ schedule: { reserved: ['s1'], favorites: [], personalTime: [] } });
    const client = { get } as unknown as ApiClient;

    const result = await verifyAfterApply(client, 'reinvent2026', { reserve: ['s1', 's2'] });

    expect(result).toEqual({
      remainingPlan: { toReserve: ['s2'], toCancelReservation: [], toFavorite: [], toUnfavorite: [] },
    });
  });

  it('GetScheduleが失敗したら例外にせず、reconcileErrorとして返す', async () => {
    const get = vi.fn().mockRejectedValue(new ApiError(401, undefined, undefined, 'GetSchedule'));
    const client = { get } as unknown as ApiClient;

    const result = await verifyAfterApply(client, 'reinvent2026', { reserve: ['s1'] });

    expect(result).toMatchObject({ reconcileError: { kind: 'authExpired', status: 401 } });
    expect(result).not.toHaveProperty('remainingPlan');
  });
});

describe('hasApplyFailure', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const empty = { successful: [], failed: [] };
  const base: ApplyResult = {
    reserve: ok(empty),
    favorite: ok(empty),
    cancelReservation: ok([{ sessionId: 's1', status: 'deleted' as const }]),
    unfavorite: ok([]),
  };
  const error = { kind: 'unknown' as const, message: 'm', hint: 'h' };

  it('全工程が成功していればfalse', () => {
    expect(hasApplyFailure(base)).toBe(false);
  });

  it('BulkResult.failed（scheduleConflict等のAPI応答上の失敗）だけならfalse（従来どおり終了コード0）', () => {
    const result = { ...base, reserve: ok({ successful: [], failed: [{ sessionId: 's1', code: 'scheduleConflict' as const }] }) };
    expect(hasApplyFailure(result)).toBe(false);
  });

  it('工程が失敗・スキップならtrue', () => {
    expect(hasApplyFailure({ ...base, reserve: { ok: false, error } })).toBe(true);
    expect(hasApplyFailure({ ...base, favorite: { ok: false, skipped: true } })).toBe(true);
  });

  it('取消・解除の件ごとにerror/skippedがあればtrue', () => {
    expect(hasApplyFailure({ ...base, cancelReservation: ok([{ sessionId: 's1', error }]) })).toBe(true);
    expect(hasApplyFailure({ ...base, unfavorite: ok([{ sessionId: 's2', skipped: true as const }]) })).toBe(true);
  });
});

import type { ApiClient } from '../api/client.js';
import type { BulkResult } from '../api/types.js';
import { toRoadieError, type RoadieError } from '../errors.js';
import { reconcile, type DesiredState, type ReconcilePlan } from '../schedule/reconcile.js';
import { runScheduleStatus } from './scheduleStatus.js';
import { reserveSessions, cancelReservation, associateFavorites, disassociateFavorite } from '../schedule/writes.js';

/** 工程単位の結果。skipped は authExpired で中断されて未実行になったことを表す */
export type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RoadieError }
  | { ok: false; skipped: true };

/** セッション単位（取消・解除）の結果。1件の失敗で残りを止めないため、件ごとに持つ */
export type ItemResult =
  | { sessionId: string; status: 'deleted' | 'alreadyGone' }
  | { sessionId: string; error: RoadieError }
  | { sessionId: string; skipped: true };

export interface ApplyResult {
  reserve: StepResult<BulkResult>;
  favorite: StepResult<BulkResult>;
  cancelReservation: StepResult<ItemResult[]>;
  unfavorite: StepResult<ItemResult[]>;
}

/**
 * ReconcilePlan（企画書 §5.9 の差分）を実際にAPIへ適用する。
 * 予約・お気に入りの追加はBulk APIで、取り消しはセッション単位（DELETE系にBulkが無いため）で行う。
 * 4工程は独立に実行し、ある工程が例外で失敗しても残りを続ける（例: 予約APIが未開放でもお気に入りは通る）。
 * ただし401(authExpired)が出たら以降は全て401になるため、残りは実行せず skipped にする。
 */
export async function executeReconcilePlan(client: ApiClient, eventId: string, plan: ReconcilePlan): Promise<ApplyResult> {
  let aborted = false;
  const noteFailure = (error: RoadieError): void => {
    if (error.kind === 'authExpired') aborted = true;
  };

  async function bulkStep(ids: string[], send: (ids: string[]) => Promise<BulkResult>): Promise<StepResult<BulkResult>> {
    if (ids.length === 0) return { ok: true, value: { successful: [], failed: [] } };
    if (aborted) return { ok: false, skipped: true };
    try {
      return { ok: true, value: await send(ids) };
    } catch (err) {
      const error = toRoadieError(err);
      noteFailure(error);
      return { ok: false, error };
    }
  }

  async function perSessionStep(
    ids: string[],
    run: (sessionId: string) => Promise<'deleted' | 'alreadyGone'>,
  ): Promise<StepResult<ItemResult[]>> {
    const items: ItemResult[] = [];
    for (const sessionId of ids) {
      if (aborted) {
        items.push({ sessionId, skipped: true });
        continue;
      }
      try {
        items.push({ sessionId, status: await run(sessionId) });
      } catch (err) {
        const error = toRoadieError(err);
        noteFailure(error);
        items.push({ sessionId, error });
      }
    }
    return { ok: true, value: items };
  }

  const reserve = await bulkStep(plan.toReserve, (ids) => reserveSessions(client, eventId, ids));
  const favorite = await bulkStep(plan.toFavorite, (ids) => associateFavorites(client, eventId, ids));
  const cancelResults = await perSessionStep(plan.toCancelReservation, (id) => cancelReservation(client, eventId, id));
  const unfavoriteResults = await perSessionStep(plan.toUnfavorite, (id) => disassociateFavorite(client, eventId, id));

  return { reserve, favorite, cancelReservation: cancelResults, unfavorite: unfavoriteResults };
}

/**
 * 例外による失敗（工程の失敗・件ごとのerror/skipped）があるか。CLIの終了コード判定に使う。
 * BulkResult.failed（scheduleConflict等のAPI応答上の失敗）は従来どおり含めない。
 */
export function hasApplyFailure(result: ApplyResult): boolean {
  const itemsFailed = (step: StepResult<ItemResult[]>) => !step.ok || step.value.some((item) => !('status' in item));
  return !result.reserve.ok || !result.favorite.ok || itemsFailed(result.cancelReservation) || itemsFailed(result.unfavorite);
}

export type VerifyResult = { remainingPlan: ReconcilePlan } | { reconcileError: RoadieError };

/** 企画書 §5.9: 実行後にGetScheduleを取り直し、まだ残っている差分を返す。取り直しに失敗しても例外にしない */
export async function verifyAfterApply(client: ApiClient, eventId: string, desired: DesiredState): Promise<VerifyResult> {
  try {
    const after = await runScheduleStatus(client, eventId);
    return { remainingPlan: reconcile(desired, after) };
  } catch (err) {
    return { reconcileError: toRoadieError(err) };
  }
}

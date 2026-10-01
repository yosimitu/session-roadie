import type { ApiClient } from '../api/client.js';
import type { BulkResult } from '../api/types.js';
import type { ReconcilePlan } from '../schedule/reconcile.js';
import { reserveSessions, cancelReservation, associateFavorites, disassociateFavorite } from '../schedule/writes.js';

export interface ApplyResult {
  reserve: BulkResult;
  favorite: BulkResult;
  cancelReservation: { sessionId: string; status: 'deleted' | 'alreadyGone' }[];
  unfavorite: { sessionId: string; status: 'deleted' | 'alreadyGone' }[];
}

/**
 * ReconcilePlan（企画書 §5.9 の差分）を実際にAPIへ適用する。
 * 予約・お気に入りの追加はBulk APIで、取り消しはセッション単位（DELETE系にBulkが無いため）で行う。
 */
export async function executeReconcilePlan(client: ApiClient, eventId: string, plan: ReconcilePlan): Promise<ApplyResult> {
  const reserve = await reserveSessions(client, eventId, plan.toReserve);
  const favorite = await associateFavorites(client, eventId, plan.toFavorite);

  const cancelResults: ApplyResult['cancelReservation'] = [];
  for (const sessionId of plan.toCancelReservation) {
    const status = await cancelReservation(client, eventId, sessionId);
    cancelResults.push({ sessionId, status });
  }

  const unfavoriteResults: ApplyResult['unfavorite'] = [];
  for (const sessionId of plan.toUnfavorite) {
    const status = await disassociateFavorite(client, eventId, sessionId);
    unfavoriteResults.push({ sessionId, status });
  }

  return { reserve, favorite, cancelReservation: cancelResults, unfavorite: unfavoriteResults };
}

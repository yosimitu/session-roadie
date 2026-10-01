import type { ApiClient } from '../api/client.js';
import type { BulkResult } from '../api/types.js';

// 企画書 §3.4: 10/8 まで ReserveSessions/CancelReservation は 409（未開放）。
// エンドポイントパスは openapi.json 由来の推測（実データ未検証）。10/8の開放後に実レスポンスで検証する。

/** 失敗を握りつぶさず BulkResult をそのまま返す（企画書 §5.9・§3.3 の部分成功設計） */
export async function reserveSessions(client: ApiClient, eventId: string, sessionIds: string[]): Promise<BulkResult> {
  if (sessionIds.length === 0) return { successful: [], failed: [] };
  return client.postJson<BulkResult>(`/v1/events/${eventId}/schedule/reservations`, { sessionIds }, 'ReserveSessions');
}

export async function cancelReservation(client: ApiClient, eventId: string, sessionId: string): Promise<'deleted' | 'alreadyGone'> {
  return client.deleteExpectNotFoundOk(`/v1/events/${eventId}/schedule/reservations/${sessionId}`, 'CancelReservation');
}

/** AssociateFavorites/DisassociateFavorite は書き込み制限の対象外（企画書 §3.4） */
export async function associateFavorites(client: ApiClient, eventId: string, sessionIds: string[]): Promise<BulkResult> {
  if (sessionIds.length === 0) return { successful: [], failed: [] };
  return client.postJson<BulkResult>(`/v1/events/${eventId}/schedule/favorites`, { sessionIds }, 'AssociateFavorites');
}

export async function disassociateFavorite(client: ApiClient, eventId: string, sessionId: string): Promise<'deleted' | 'alreadyGone'> {
  return client.deleteExpectNotFoundOk(`/v1/events/${eventId}/schedule/favorites/${sessionId}`, 'DisassociateFavorite');
}

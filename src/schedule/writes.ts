import type { ApiClient } from '../api/client.js';
import type { BulkResult } from '../api/types.js';

// 企画書 §3.4: 10/8 まで ReserveSessions/CancelReservation は 409（未開放）。
// エンドポイントパスは 2026-10-01、実機のopenapi.json（https://api.awsevents.com/v1/openapi.json）で
// 確認・修正済み（`/v1/events/{eventId}/favorites` 等。旧実装の `/schedule/favorites` 等は誤りで、
// 実機でAPI Gateway既定のIAMオーソライザーにフォールバックし403になることを確認した）。
// 1リクエストにつき sessionIds は最大10件（openapi.jsonのmaxItems）。
// レスポンスは {"result": BulkResult} と result キーでラップされている（2026-10-01実機確認。
// AssociateFavoritesで実機検証、ReserveSessionsもopenapi.jsonのスキーマが同形のため同様に扱う）。

interface BulkResultResponse {
  result: BulkResult;
}

/** 失敗を握りつぶさず BulkResult をそのまま返す（企画書 §5.9・§3.3 の部分成功設計） */
export async function reserveSessions(client: ApiClient, eventId: string, sessionIds: string[]): Promise<BulkResult> {
  if (sessionIds.length === 0) return { successful: [], failed: [] };
  const response = await client.postJson<BulkResultResponse>(`/v1/events/${eventId}/reservations`, { sessionIds }, 'ReserveSessions');
  return response.result;
}

export async function cancelReservation(client: ApiClient, eventId: string, sessionId: string): Promise<'deleted' | 'alreadyGone'> {
  return client.deleteExpectNotFoundOk(`/v1/events/${eventId}/reservations/${sessionId}`, 'CancelReservation');
}

/** AssociateFavorites/DisassociateFavorite は書き込み制限の対象外（企画書 §3.4） */
export async function associateFavorites(client: ApiClient, eventId: string, sessionIds: string[]): Promise<BulkResult> {
  if (sessionIds.length === 0) return { successful: [], failed: [] };
  const response = await client.postJson<BulkResultResponse>(`/v1/events/${eventId}/favorites`, { sessionIds }, 'AssociateFavorites');
  return response.result;
}

export async function disassociateFavorite(client: ApiClient, eventId: string, sessionId: string): Promise<'deleted' | 'alreadyGone'> {
  return client.deleteExpectNotFoundOk(`/v1/events/${eventId}/favorites/${sessionId}`, 'DisassociateFavorite');
}

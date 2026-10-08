import { ApiError } from './api/client.js';
import type { OperationName } from './api/quotas.js';

export type RoadieErrorKind = 'authExpired' | 'notOpenYet' | 'forbidden' | 'rateLimited' | 'network' | 'unknown';

export interface RoadieError {
  kind: RoadieErrorKind;
  status?: number;
  operation?: OperationName;
  /** 原因（日本語1文） */
  message: string;
  /** 次にすること（日本語1文） */
  hint: string;
  /** APIのエラー本文（あれば） */
  body?: unknown;
}

// 予約の作成・取消は 2026-10-08 のAPI開放前は 403/409 になる（企画書 §3.4）
const RESERVATION_OPERATIONS: OperationName[] = ['ReserveSessions', 'CancelReservation'];

function where(status: number, operation?: OperationName): string {
  return operation ? `HTTP ${status}, ${operation}` : `HTTP ${status}`;
}

function fromApiError(err: ApiError): RoadieError {
  const { status, operation, body } = err;
  const base = { status, operation, body };
  const at = where(status, operation);

  if (status === 401) {
    return { kind: 'authExpired', ...base, message: `認証が切れています（${at}）`, hint: 'auth_login でサインインし直してから再実行してください' };
  }
  if ((status === 403 || status === 409) && operation && RESERVATION_OPERATIONS.includes(operation)) {
    return {
      kind: 'notOpenYet',
      ...base,
      message: `予約APIがまだ開放されていない可能性があります（${at}）`,
      hint: '2026-10-08 の開放後に再実行してください。お気に入り・個人予定の操作は影響を受けません',
    };
  }
  if (status === 403) {
    return { kind: 'forbidden', ...base, message: `権限がありません（${at}）`, hint: 'サインイン状態を確認し、詳細（body）の内容を確認してください' };
  }
  if (status === 429) {
    return { kind: 'rateLimited', ...base, message: `リクエスト数の上限に達しました（${at}）`, hint: '少し待ってから再実行してください' };
  }
  return { kind: 'unknown', ...base, message: `APIがエラーを返しました（${at}）`, hint: '詳細（body）の内容を確認してください' };
}

/** CLI・MCP共通。あらゆる例外を「原因＋次の一手」つきのRoadieErrorに変換する */
export function toRoadieError(err: unknown): RoadieError {
  if (err instanceof ApiError) return fromApiError(err);
  // Node の fetch は接続失敗・切断を TypeError('fetch failed') で投げる。他のTypeError（バグ）は区別する
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return { kind: 'network', message: 'APIに接続できませんでした', hint: 'ネットワーク接続を確認してから再実行してください' };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'unknown', message, hint: 'メッセージの内容を確認して対処してください' };
}

export function formatRoadieErrorForCli(e: RoadieError): string[] {
  const lines = [`エラー: ${e.message}`, `次にすること: ${e.hint}`];
  if (e.body !== undefined) lines.push(`詳細: ${JSON.stringify(e.body)}`);
  return lines;
}

export function mcpErrorResult(err: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(toRoadieError(err), null, 2) }], isError: true };
}

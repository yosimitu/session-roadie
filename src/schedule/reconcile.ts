import type { Schedule } from '../api/types.js';

// 企画書 §5.9「失敗を取りこぼさない」: 「意図」を単一の真実の情報源とし、
// GetSchedule で取り直した実スケジュールとの差分だけを計算する。
// 「意図」は自由文（Intent.freeText）から対話/推論で導出した、
// あるべき状態（予約したい・お気に入りにしたいセッションID集合）として渡す。
// 省略（undefined）は「その種類は現状維持」。LLMが引数を省いただけで全解除される事故を防ぐため、
// 全解除したい場合は空配列 [] を明示する。
export interface DesiredState {
  reserve?: string[];  // sessionId[]
  favorite?: string[]; // sessionId[]
}

export interface ReconcilePlan {
  toReserve: string[];
  toCancelReservation: string[];
  toFavorite: string[];
  toUnfavorite: string[];
}

function diffIds(desired: string[] | undefined, actual: string[]): { toAdd: string[]; toRemove: string[] } {
  if (desired === undefined) return { toAdd: [], toRemove: [] };
  const desiredSet = new Set(desired);
  const actualSet = new Set(actual);
  return {
    toAdd: desired.filter((id) => !actualSet.has(id)),
    toRemove: actual.filter((id) => !desiredSet.has(id)),
  };
}

/** 意図（あるべき状態）と実スケジュールを突き合わせ、差分だけを返す。何度呼んでも同じ結果に収束する。 */
export function reconcile(desired: DesiredState, actual: Schedule): ReconcilePlan {
  const reservation = diffIds(desired.reserve, actual.reserved);
  const favorite = diffIds(desired.favorite, actual.favorites);
  return {
    toReserve: reservation.toAdd,
    toCancelReservation: reservation.toRemove,
    toFavorite: favorite.toAdd,
    toUnfavorite: favorite.toRemove,
  };
}

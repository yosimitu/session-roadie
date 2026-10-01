import type { Session } from '../api/types.js';
import { computeTravelBlock, type TravelBlockResult } from '../schedule/travelBlock.js';

export interface PlannedTravelBlock {
  from: Session;
  to: Session;
  result: TravelBlockResult;
}

function sortKey(session: Session): string {
  const { date, time } = session.sessionTime ?? {};
  return date && time ? `${date}T${time}` : '';
}

/**
 * 予約済みセッション一覧を時刻順に並べ、同日内で隣接するセッション間の移動時間を計算する（企画書 §5.3）。
 * 時刻情報が欠けているセッションはソート後に先頭へ寄るため、事前に除外する。
 */
export function planTravelBlocks(sessions: Session[]): PlannedTravelBlock[] {
  const timed = sessions.filter((s) => s.sessionTime?.date && s.sessionTime?.time && s.sessionTime?.length);
  const sorted = [...timed].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const blocks: PlannedTravelBlock[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from.sessionTime?.date !== to.sessionTime?.date) continue;
    const result = computeTravelBlock(from, to);
    if (result) blocks.push({ from, to, result });
  }
  return blocks;
}

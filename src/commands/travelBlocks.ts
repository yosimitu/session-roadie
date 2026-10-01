import type { ApiClient } from '../api/client.js';
import type { Schedule, Session } from '../api/types.js';
import { computeTravelBlock, type TravelBlockResult } from '../schedule/travelBlock.js';
import { createPersonalTime, resolvePersonalTimeId } from '../schedule/personalTime.js';

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

export interface TravelBlockPlan {
  /** スナップショットに無いため移動時間を計算できなかった予約済みセッションID */
  missingSessionIds: string[];
  /** 移動が間に合わないブロック（警告表示用） */
  insufficientBlocks: PlannedTravelBlock[];
  /** 新規に確保すべきブロック（既存のPersonalTimeと重複するものは除外済み） */
  candidates: PlannedTravelBlock[];
}

/**
 * GetScheduleとローカルスナップショットから、CLI/MCPの両方で使える移動時間ブロックの計画を作る。
 * 実行（CreatePersonalTime）は行わない。確認はクライアント側（CLIの対話プロンプト、またはMCP越しのLLM）が担う。
 */
export function buildTravelBlockPlan(schedule: Schedule, snapshot: Session[]): TravelBlockPlan {
  const snapshotById = new Map(snapshot.map((s) => [s.sessionId, s]));
  const reservedSessions = schedule.reserved
    .map((id) => snapshotById.get(id))
    .filter((s): s is Session => Boolean(s));
  const missingSessionIds = schedule.reserved.filter((id) => !snapshotById.has(id));

  const blocks = planTravelBlocks(reservedSessions);
  const insufficientBlocks = blocks.filter((b) => !b.result.sufficient);
  const candidates = blocks
    .filter((b) => b.result.sufficient && b.result.personalTime)
    .filter((b) => !resolvePersonalTimeId(schedule, b.result.personalTime!));

  return { missingSessionIds, insufficientBlocks, candidates };
}

/** 計画済みの移動時間ブロックを実際にCreatePersonalTimeで確保する。作成した件数を返す。 */
export async function applyTravelBlocks(client: ApiClient, eventId: string, candidates: PlannedTravelBlock[]): Promise<number> {
  for (const blk of candidates) {
    await createPersonalTime(client, eventId, blk.result.personalTime!);
  }
  return candidates.length;
}

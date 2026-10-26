import type { Session } from '../api/types.js';
import { planTravelBlocks } from '../commands/travelBlocks.js';

/** 1日の予約の負荷。会場間の移動時間は travelTime.ts の概算値（実測ではない） */
export interface DayLoad {
  date: string;
  sessions: number;
  sessionMinutes: number;
  /** 会場が変わる連続予約の組数 */
  moves: number;
  /** 会場が変わる組の移動時間（概算）の合計 */
  travelMinutes: number;
}

/** 予約済みセッションを日ごとに集計する。日時が読めないセッションは数えない */
export function computeDayLoads(reserved: Session[]): Map<string, DayLoad> {
  const loads = new Map<string, DayLoad>();
  const load = (date: string): DayLoad => {
    let l = loads.get(date);
    if (!l) {
      l = { date, sessions: 0, sessionMinutes: 0, moves: 0, travelMinutes: 0 };
      loads.set(date, l);
    }
    return l;
  };

  for (const s of reserved) {
    const { date, time, length } = s.sessionTime ?? {};
    if (!date || !time) continue;
    const l = load(date);
    l.sessions += 1;
    const minutes = Number(length);
    if (Number.isFinite(minutes)) l.sessionMinutes += minutes;
  }

  for (const block of planTravelBlocks(reserved)) {
    if (block.result.requiredMinutes === 0) continue;
    const l = load(block.from.sessionTime!.date!);
    l.moves += 1;
    l.travelMinutes += block.result.requiredMinutes;
  }
  return loads;
}

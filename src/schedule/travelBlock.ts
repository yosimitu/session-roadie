import type { Session, PersonalTimeInput } from '../api/types.js';
import { ARRIVAL_BUFFER_MINUTES, getTravelMinutes } from './travelTime.js';
import { sanitizeForPersonalTime } from './sanitizeText.js';
import { sessionStartUtc, sessionEndUtc, toPersonalTimeDateTime } from './sessionTimeUtc.js';

export const TRAVEL_BLOCK_DESCRIPTION_MARKER = '分の移動時間を確保';

export interface TravelBlockResult {
  /** 移動時間 + 到着の余裕（開始の10分前）を取れるか */
  sufficient: boolean;
  /** 移動に要する分（移動時間ブロックの長さの元） */
  requiredMinutes: number;
  /** 次のセッション開始の何分前までに部屋に着く必要があるか */
  arrivalBufferMinutes: number;
  /** 移動 + 到着の余裕。空きがこれを下回ると sufficient が false になる */
  neededMinutes: number;
  availableMinutes: number;
  personalTime?: PersonalTimeInput;
}

/**
 * 連続する2セッションの会場・時刻から移動時間を確保できるか判定する（企画書 §5.3）。
 * 席は開始の10分前までに着かないと譲られるため、判定には移動時間に加えて10分の余裕を見込む。
 * 間に合う場合は CreatePersonalTime にそのまま渡せる入力を生成する（ブロックは移動時間だけ。余裕の分は空けておく）。
 * 間に合わない、または会場/時刻が欠けている場合は personalTime を省略する。
 */
export function computeTravelBlock(sessionA: Session, sessionB: Session): TravelBlockResult | undefined {
  if (!sessionA.venue || !sessionB.venue) return undefined;
  const endA = sessionEndUtc(sessionA);
  const startB = sessionStartUtc(sessionB);
  if (!endA || !startB) return undefined;

  const availableMinutes = Math.round((startB.getTime() - endA.getTime()) / 60_000);
  const requiredMinutes = getTravelMinutes(sessionA.venue, sessionB.venue);
  const arrivalBufferMinutes = ARRIVAL_BUFFER_MINUTES;
  const neededMinutes = requiredMinutes + arrivalBufferMinutes;
  const sufficient = availableMinutes >= neededMinutes;
  const base = { sufficient, requiredMinutes, arrivalBufferMinutes, neededMinutes, availableMinutes };

  if (!sufficient || requiredMinutes === 0) return base;

  // 空き時間すべてではなく、前のセッションの終了直後から、必要な移動時間（5分刻みに切り上げ）だけを埋める
  const blockMinutes = Math.ceil(requiredMinutes / 5) * 5;
  const blockEnd = new Date(endA.getTime() + blockMinutes * 60_000);

  const personalTime: PersonalTimeInput = {
    startDateTime: toPersonalTimeDateTime(endA),
    endDateTime: toPersonalTimeDateTime(blockEnd),
    title: sanitizeForPersonalTime(`${sessionA.venue} → ${sessionB.venue} 移動`),
    description: sanitizeForPersonalTime(`${requiredMinutes}${TRAVEL_BLOCK_DESCRIPTION_MARKER}（概算値・要検証）`),
  };

  return { ...base, personalTime };
}

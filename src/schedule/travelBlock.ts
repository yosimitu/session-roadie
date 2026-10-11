import type { Session, PersonalTimeInput } from '../api/types.js';
import { getTravelMinutes } from './travelTime.js';
import { sanitizeForPersonalTime } from './sanitizeText.js';
import { sessionStartUtc, sessionEndUtc, toPersonalTimeDateTime } from './sessionTimeUtc.js';

export const TRAVEL_BLOCK_DESCRIPTION_MARKER = '分の移動時間を確保';

export interface TravelBlockResult {
  sufficient: boolean;
  requiredMinutes: number;
  availableMinutes: number;
  personalTime?: PersonalTimeInput;
}

/**
 * 連続する2セッションの会場・時刻から移動時間を確保できるか判定する（企画書 §5.3）。
 * 間に合う場合は CreatePersonalTime にそのまま渡せる入力を生成する。
 * 間に合わない、または会場/時刻が欠けている場合は personalTime を省略する。
 */
export function computeTravelBlock(sessionA: Session, sessionB: Session): TravelBlockResult | undefined {
  if (!sessionA.venue || !sessionB.venue) return undefined;
  const endA = sessionEndUtc(sessionA);
  const startB = sessionStartUtc(sessionB);
  if (!endA || !startB) return undefined;

  const availableMinutes = Math.round((startB.getTime() - endA.getTime()) / 60_000);
  const requiredMinutes = getTravelMinutes(sessionA.venue, sessionB.venue);
  const sufficient = availableMinutes >= requiredMinutes;

  if (!sufficient || requiredMinutes === 0) {
    return { sufficient, requiredMinutes, availableMinutes };
  }

  // 空き時間すべてではなく、前のセッションの終了直後から、必要な移動時間（5分刻みに切り上げ）だけを埋める
  const blockMinutes = Math.ceil(requiredMinutes / 5) * 5;
  const blockEnd = new Date(endA.getTime() + blockMinutes * 60_000);

  const personalTime: PersonalTimeInput = {
    startDateTime: toPersonalTimeDateTime(endA),
    endDateTime: toPersonalTimeDateTime(blockEnd),
    title: sanitizeForPersonalTime(`${sessionA.venue} → ${sessionB.venue} 移動`),
    description: sanitizeForPersonalTime(`${requiredMinutes}${TRAVEL_BLOCK_DESCRIPTION_MARKER}（概算値・要検証）`),
  };

  return { sufficient, requiredMinutes, availableMinutes, personalTime };
}

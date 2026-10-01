import type { Session, PersonalTimeInput } from '../api/types.js';
import { getTravelMinutes } from './travelTime.js';
import { sanitizeForPersonalTime } from './sanitizeText.js';

// re:Invent開催期間（12月上旬・会期は2026-11-30〜12-04）のラスベガスはPST固定（UTC-8）。
// サマータイムの影響を受けない時期のみを想定（要検証: 他の日程での再利用時は見直す）。
const VENUE_UTC_OFFSET_HOURS = 8;

export interface TravelBlockResult {
  sufficient: boolean;
  requiredMinutes: number;
  availableMinutes: number;
  personalTime?: PersonalTimeInput;
}

function sessionStartUtc(session: Session): Date | undefined {
  const { date, time } = session.sessionTime ?? {};
  if (!date || !time) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return undefined;
  return new Date(Date.UTC(year, month - 1, day, hour + VENUE_UTC_OFFSET_HOURS, minute));
}

function sessionEndUtc(session: Session): Date | undefined {
  const start = sessionStartUtc(session);
  const lengthMinutes = Number(session.sessionTime?.length);
  if (!start || Number.isNaN(lengthMinutes)) return undefined;
  return new Date(start.getTime() + lengthMinutes * 60_000);
}

/** PersonalTimeInput の制約（末尾Z/オフセット禁止のUTC文字列）に合わせる */
function toPersonalTimeDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '');
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

  const personalTime: PersonalTimeInput = {
    startDateTime: toPersonalTimeDateTime(endA),
    endDateTime: toPersonalTimeDateTime(startB),
    title: sanitizeForPersonalTime(`${sessionA.venue} → ${sessionB.venue} 移動`),
    description: sanitizeForPersonalTime(`${requiredMinutes}分の移動時間を確保（概算値・要検証）`),
  };

  return { sufficient, requiredMinutes, availableMinutes, personalTime };
}

import type { PersonalTime } from '../api/types.js';
import { VENUE_UTC_OFFSET_HOURS } from './sessionTimeUtc.js';
import { NOTE_REMINDER_TITLE_PREFIX } from './noteReminder.js';
import { TRAVEL_BLOCK_DESCRIPTION_MARKER } from './travelBlock.js';

export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * PersonalTimeの日時は末尾Zなしの会場現地時刻（"YYYY-MM-DDTHH:MM:SS"、アプリは保存値をそのまま表示する）。
 * sessionStartUtc/sessionEndUtc と比べられるよう、現地時刻 + 8時間の Date にそろえて返す。
 */
export function personalTimeRangeUtc(pt: PersonalTime): TimeRange | undefined {
  const start = new Date(`${pt.startDateTime}Z`);
  const end = new Date(`${pt.endDateTime}Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  return {
    start: new Date(start.getTime() + VENUE_UTC_OFFSET_HOURS * 3_600_000),
    end: new Date(end.getTime() + VENUE_UTC_OFFSET_HOURS * 3_600_000),
  };
}

/**
 * 利用者が自分で入れた予定（基調講演など）だけを「動かせない予定」として扱う。
 * re:Roadieが書き込んだ移動時間ブロック・メモのリマインダーは予約から派生した予定なので、
 * 重複判定に含めると予約を組み替えるたびに古いブロックが邪魔をするため除外する。
 */
export function blockingPersonalTimes(personalTimes: PersonalTime[]): PersonalTime[] {
  return personalTimes.filter(
    (pt) => !pt.title.startsWith(NOTE_REMINDER_TITLE_PREFIX) && !pt.description.includes(TRAVEL_BLOCK_DESCRIPTION_MARKER),
  );
}

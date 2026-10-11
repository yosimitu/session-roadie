import type { Session } from '../api/types.js';

// re:Invent開催期間（12月上旬・会期は2026-11-30〜12-04）のラスベガスはPST固定（UTC-8）。
// サマータイムの影響を受けない時期のみを想定（要検証: 他の日程での再利用時は見直す）。
export const VENUE_UTC_OFFSET_HOURS = 8;

export function sessionStartUtc(session: Session): Date | undefined {
  const { date, time } = session.sessionTime ?? {};
  if (!date || !time) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return undefined;
  return new Date(Date.UTC(year, month - 1, day, hour + VENUE_UTC_OFFSET_HOURS, minute));
}

export function sessionEndUtc(session: Session): Date | undefined {
  const start = sessionStartUtc(session);
  const lengthMinutes = Number(session.sessionTime?.length);
  if (!start || Number.isNaN(lengthMinutes)) return undefined;
  return new Date(start.getTime() + lengthMinutes * 60_000);
}

/**
 * PersonalTimeInput に書く日時（末尾Z/オフセットなし）。
 * 公式アプリは保存値をそのまま表示する（2026-10-11 実機確認）ため、UTC ではなく会場の現地時刻で書く。
 * 引数は sessionStartUtc/sessionEndUtc と同じ「現地時刻 + 8時間」の Date。
 */
export function toPersonalTimeDateTime(date: Date): string {
  return new Date(date.getTime() - VENUE_UTC_OFFSET_HOURS * 3_600_000).toISOString().replace(/\.\d+Z$/, '');
}

import type { ApiClient } from '../api/client.js';
import type { PersonalTimeInput, Schedule } from '../api/types.js';

// 2026-09-28 実データ確認: CreatePersonalTime/DeletePersonalTime は10/8の予約API開放を待たずに動作する
// （企画書の書き込み制限の対象外）。成功レスポンスは {"content":""} のみで personalTimeId は返らないため、
// 作成直後に GetSchedule を呼び直して resolvePersonalTimeId で ID を特定する必要がある。

export async function createPersonalTime(client: ApiClient, eventId: string, input: PersonalTimeInput): Promise<void> {
  await client.postJson<{ content: string }>(`/v1/events/${eventId}/schedule/personal-time`, input);
}

export async function deletePersonalTime(client: ApiClient, eventId: string, personalTimeId: string): Promise<'deleted' | 'alreadyGone'> {
  return client.deleteExpectNotFoundOk(`/v1/events/${eventId}/schedule/personal-time/${personalTimeId}`);
}

/** 作成直後の GetSchedule から、startDateTime + title が一致するエントリの personalTimeId を探す */
export function resolvePersonalTimeId(schedule: Schedule, input: PersonalTimeInput): string | undefined {
  return schedule.personalTime.find(
    (entry) => entry.startDateTime === input.startDateTime && entry.title === input.title,
  )?.personalTimeId;
}

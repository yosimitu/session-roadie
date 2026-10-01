import type { ApiClient } from '../api/client.js';
import type { Schedule } from '../api/types.js';

// 2026-10-01 実データ確認: GetScheduleのレスポンスは {"schedule": {...}} とscheduleキーでラップされている
// （2026-09-28のMCP実データ確認記録と一致。実装時に見落としていたため、ここで解消する）。
interface GetScheduleResponse {
  schedule: Schedule;
}

export async function runScheduleStatus(client: ApiClient, eventId: string): Promise<Schedule> {
  const response = await client.get<GetScheduleResponse>(`/v1/events/${eventId}/schedule`, 'GetSchedule');
  return response.schedule;
}

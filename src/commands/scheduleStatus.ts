import type { ApiClient } from '../api/client.js';
import type { Schedule } from '../api/types.js';

export async function runScheduleStatus(client: ApiClient, eventId: string): Promise<Schedule> {
  return client.get<Schedule>(`/v1/events/${eventId}/schedule`);
}

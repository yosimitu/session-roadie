import type { ApiClient } from '../api/client.js';
import type { ListSessionsPage, Session } from '../api/types.js';

export async function fetchAllSessions(client: ApiClient, eventId: string): Promise<Session[]> {
  const sessions: Session[] = [];
  let nextToken: string | undefined;
  do {
    const query = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '';
    const page = await client.get<ListSessionsPage>(`/v1/events/${eventId}/sessions${query}`);
    sessions.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  return sessions;
}

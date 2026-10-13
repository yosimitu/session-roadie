import type { ApiClient } from '../api/client.js';
import type { ListSessionsPage, Session } from '../api/types.js';

/**
 * 全ページを取得する。取得件数が先頭ページの totalCount と違うときは警告する
 * （ページが短くても最終ページとは限らないため、取りこぼしに気づく手段として使う）。
 * 取得中にカタログが更新されて一時的にずれることもあるので、中断はしない。
 */
export async function fetchAllSessions(
  client: ApiClient,
  eventId: string,
  warn: (message: string) => void = (m) => console.error(m),
): Promise<Session[]> {
  const sessions: Session[] = [];
  let nextToken: string | undefined;
  let totalCount: number | undefined;
  do {
    const query = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '';
    const page = await client.get<ListSessionsPage>(`/v1/events/${eventId}/sessions${query}`, 'ListSessions');
    if (totalCount === undefined && typeof page.totalCount === 'number') totalCount = page.totalCount;
    sessions.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);
  if (totalCount !== undefined && sessions.length !== totalCount) {
    warn(`警告: 取得件数（${sessions.length}件）が totalCount（${totalCount}件）と一致しません。取りこぼしの可能性があります。時間をおいて再実行してください。`);
  }
  return sessions;
}

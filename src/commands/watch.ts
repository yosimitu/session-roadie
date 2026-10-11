import type { ApiClient } from '../api/client.js';
import type { Session } from '../api/types.js';
import { fetchAllSessions } from '../catalog/fetchAll.js';
import { searchCatalog } from '../catalog/search.js';
import { buildWatchState, detectWatchEvents, type WatchContext, type WatchEvent } from '../catalog/watch.js';
import { loadWatchState, saveWatchState } from '../catalog/watchState.js';
import { datesWithinAttendance, searchDefaultsFromProfile } from '../planning/preferences.js';
import type { Profile } from '../profile/profileStore.js';
import { runScheduleStatus } from './scheduleStatus.js';

export type WatchStatus = 'empty' | 'baseline' | 'checked' | 'shrunk';

const MIN_CATALOG_RATIO = 0.5;

export interface WatchResult {
  status: WatchStatus;
  sessionCount: number;
  events: WatchEvent[];
}

/** 新着のうち、catalog_search の既定の絞り込み（参加日・希望レベル・スポンサー除外）と関心テーマに合うものだけを残す */
function makeNewSessionFilter(profile: Profile | undefined, current: Session[]): WatchContext['filterNew'] {
  const eventDates = [...new Set(current.map((s) => s.sessionTime?.date).filter((d): d is string => Boolean(d)))].sort();
  const dates = datesWithinAttendance(eventDates, profile);
  const topics = profile?.interestTopics?.length ? profile.interestTopics : undefined;
  return (added) => {
    const matched = searchCatalog(added, {
      ...searchDefaultsFromProfile(profile),
      ...(dates ? { dates } : {}),
      ...(topics ? { topics } : {}),
      limit: Math.max(added.length, 1),
    });
    const ids = new Set(matched.items.map((i) => i.sessionId));
    return added.filter((s) => ids.has(s.sessionId));
  };
}

/**
 * カタログ全件を取得し、前回の観測と比べて、知らせるべき変化を返す。予約などの書き込みはしない。
 * - 取得結果が0件のときは、状態を作らず・更新せず、スケジュールも取らない（API が一時的に空を返す間の保護）。
 * - 前回の観測が無い初回は、基準を保存するだけでイベントを返さない（新着が一度に大量に出るのを避ける）。
 */
export async function runWatchOnce(
  client: ApiClient,
  eventId: string,
  dataDir: string,
  profile: Profile | undefined,
  now: Date = new Date(),
): Promise<WatchResult> {
  const fetched = await fetchAllSessions(client, eventId);
  const current = [...new Map(fetched.map((s) => [s.sessionId, s])).values()];
  if (current.length === 0) return { status: 'empty', sessionCount: 0, events: [] };

  const previous = loadWatchState(eventId, dataDir);
  if (previous && current.length < Object.keys(previous.sessions).length * MIN_CATALOG_RATIO) {
    return { status: 'shrunk', sessionCount: current.length, events: [] };
  }

  const schedule = await runScheduleStatus(client, eventId);
  const events = previous
    ? detectWatchEvents(previous, current, {
        reservedIds: new Set(schedule.reserved),
        favoriteIds: new Set(schedule.favorites),
        filterNew: makeNewSessionFilter(profile, current),
      })
    : [];

  saveWatchState(eventId, buildWatchState(current, now, previous), dataDir);
  return { status: previous ? 'checked' : 'baseline', sessionCount: current.length, events };
}

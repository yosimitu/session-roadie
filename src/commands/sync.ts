import type { ApiClient } from '../api/client.js';
import type { Session } from '../api/types.js';
import { fetchAllSessions } from '../catalog/fetchAll.js';
import { loadSnapshot, saveSnapshot, loadSnapshotByDate, listSnapshotDates } from '../catalog/store.js';
import { diffCatalog, type CatalogDiff } from '../catalog/diff.js';

/**
 * 取得結果が0件で、保存済みの最新スナップショットが1件以上ある場合は例外を投げる。
 * APIが一時的に空を返したときに、有効なスナップショットを空で上書きしないための保護。
 */
function assertNotEmptyOverwrite(eventId: string, dataDir: string, after: Session[]): void {
  if (after.length > 0) return;
  const latest = loadSnapshot(eventId, dataDir);
  if (latest && latest.length > 0) {
    throw new Error(
      `カタログの取得結果が0件でした。保存済みのスナップショット（${latest.length}件）を空で上書きしないため、保存せず中断します。APIの状態を確認して、時間をおいて再実行してください。`,
    );
  }
}

/**
 * カタログを全件取得し、前回のローカルスナップショットと比較して差分を返す。
 * 帰国後機能の前提（企画書 §3.6・§6）として、取得後は必ずスナップショットを保存し直す。
 */
export async function runSync(client: ApiClient, eventId: string, dataDir: string): Promise<CatalogDiff> {
  const before = loadSnapshot(eventId, dataDir) ?? [];
  const after = await fetchAllSessions(client, eventId);
  assertNotEmptyOverwrite(eventId, dataDir, after);
  const diff = diffCatalog(before, after);
  saveSnapshot(eventId, after, dataDir);
  return diff;
}

export interface SyncSinceResult {
  diff: CatalogDiff;
  /** 保存済みの日付別スナップショットの日付一覧（新しい順） */
  availableDates: string[];
}

/**
 * 「ここ一週間で追加されたセッションは？」のような、任意の過去日付（YYYY-MM-DD）との比較を行う。
 * 前回保存分としか比較できない runSync と異なり、過去に保存した日付別スナップショット
 * （src/catalog/store.ts の saveSnapshot が自動的に記録する）の中から指定日を探す。
 * 指定日が無い場合も最新カタログの取得・保存は行ったうえで例外を投げる（取り直しの手間を省くため）。
 */
export async function runSyncSince(client: ApiClient, eventId: string, dataDir: string, sinceDate: string): Promise<SyncSinceResult> {
  const after = await fetchAllSessions(client, eventId);
  assertNotEmptyOverwrite(eventId, dataDir, after);
  const before = loadSnapshotByDate(eventId, dataDir, sinceDate);
  saveSnapshot(eventId, after, dataDir);

  const availableDates = listSnapshotDates(eventId, dataDir);
  if (!before) {
    const hint = availableDates.length > 0
      ? `利用可能な日付: ${availableDates.join(', ')}`
      : 'まだ記録がありません（毎日 sync を実行すると記録されていきます）。';
    throw new Error(`${sinceDate} のスナップショットが見つかりません。${hint}`);
  }

  return { diff: diffCatalog(before, after), availableDates };
}

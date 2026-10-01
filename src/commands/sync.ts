import type { ApiClient } from '../api/client.js';
import { fetchAllSessions } from '../catalog/fetchAll.js';
import { loadSnapshot, saveSnapshot } from '../catalog/store.js';
import { diffCatalog, type CatalogDiff } from '../catalog/diff.js';

/**
 * カタログを全件取得し、前回のローカルスナップショットと比較して差分を返す。
 * 帰国後機能の前提（企画書 §3.6・§6）として、取得後は必ずスナップショットを保存し直す。
 */
export async function runSync(client: ApiClient, eventId: string, dataDir: string): Promise<CatalogDiff> {
  const before = loadSnapshot(eventId, dataDir) ?? [];
  const after = await fetchAllSessions(client, eventId);
  const diff = diffCatalog(before, after);
  saveSnapshot(eventId, after, dataDir);
  return diff;
}

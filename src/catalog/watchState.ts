import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WatchState } from './watch.js';

// 手動の catalog_sync のスナップショットとは別に持つ。sync を実行しても、watch の比較元は変わらない。
function statePath(eventId: string, dir: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(eventId)) throw new Error(`eventId は英数字・ハイフン・アンダースコアのみ使えます: "${eventId}"`);
  return join(dir, `watch-state-${eventId}.json`);
}

export function loadWatchState(eventId: string, dir: string): WatchState | undefined {
  const path = statePath(eventId, dir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<WatchState>;
    if (typeof parsed.observedAt !== 'string' || typeof parsed.sessions !== 'object' || parsed.sessions === null) return undefined;
    return parsed as WatchState;
  } catch {
    return undefined;
  }
}

export function saveWatchState(eventId: string, state: WatchState, dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(eventId, dir), JSON.stringify(state));
}

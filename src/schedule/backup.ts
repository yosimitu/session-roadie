import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Schedule } from '../api/types.js';
import type { ReconcilePlan } from './reconcile.js';

/** 差分に、書き込みを伴う変更が1件でもあるか */
export function hasPlanChanges(plan: ReconcilePlan): boolean {
  return [plan.toReserve, plan.toCancelReservation, plan.toFavorite, plan.toUnfavorite].some((l) => l.length > 0);
}

/**
 * apply の直前の予約・お気に入りを data/ に保存する。reserve/favorite は「あるべき状態の全体」なので、
 * 渡したリストから外したセッションは取り消される。誤って外したときに、元の一覧から戻せるようにする。
 * 保存できなければ例外を投げ、書き込みには進ませない。
 */
export function saveScheduleBackup(eventId: string, before: Schedule, dataDir: string, now: Date = new Date()): string {
  mkdirSync(dataDir, { recursive: true });
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '');
  const path = join(dataDir, `schedule-backup-${eventId}-${stamp}.json`);
  const body = { savedAt: now.toISOString(), eventId, reserved: before.reserved, favorites: before.favorites };
  writeFileSync(path, JSON.stringify(body, null, 2), { mode: 0o600 });
  return path;
}

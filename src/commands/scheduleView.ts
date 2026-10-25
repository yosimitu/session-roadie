import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApiClient } from '../api/client.js';
import type { Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import { buildScheduleHtml } from '../reporting/scheduleHtml.js';
import { buildDigest } from '../reporting/digestHtml.js';
import type { Lang } from '../reporting/i18n.js';
import { listSnapshotDates, loadSnapshotByDate } from '../catalog/store.js';
import { runScheduleStatus } from './scheduleStatus.js';

export interface ScheduleViewOptions {
  snapshot: Session[];
  outPath: string;
  profile?: Profile;
  date?: string; // 会場PSTの "YYYY-MM-DD"。「予定」タブをその日だけにする。省略時は全日
  account?: string; // サインイン中の Builder ID のメール。指定すると、ヘッダーに出す（どのアカウントの予定かを見分けるため）
  dataDir?: string; // 日付別スナップショットの場所。指定すると、比較元との差分を「新着」にする
  newSince?: string; // 新着の比較元にするスナップショットの日付。省略時は今日より前で最新の日付
  lang?: Lang; // 画面の言語。省略時は日本語
}

export interface ScheduleViewResult {
  path: string;
  reserved: number;
  favorites: number;
  personalTime: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 比較元のスナップショットに無かったセッションを新着とする。比較元が無ければ新着なし */
function findNewSessions(eventId: string, options: ScheduleViewOptions, now: Date): { ids: string[]; baseline: string } {
  if (!options.dataDir) return { ids: [], baseline: '' };
  const today = now.toISOString().slice(0, 10);
  const baseline = options.newSince ?? listSnapshotDates(eventId, options.dataDir).find((d) => d < today);
  if (!baseline) return { ids: [], baseline: '' };
  const before = loadSnapshotByDate(eventId, options.dataDir, baseline);
  if (!before) throw new Error(`${baseline} のスナップショットが保存されていません（catalog_sync の availableDates で保存済みの日付を確認できます）`);
  const known = new Set(before.map((s) => s.sessionId));
  return { ids: options.snapshot.filter((s) => !known.has(s.sessionId)).map((s) => s.sessionId), baseline };
}

/** 現在のスケジュールを取得して、参照専用のHTMLに書き出す（予定は変更しない） */
export async function runScheduleView(client: ApiClient, eventId: string, options: ScheduleViewOptions): Promise<ScheduleViewResult> {
  if (options.date !== undefined && !DATE_PATTERN.test(options.date)) {
    throw new Error(`date は YYYY-MM-DD 形式で指定してください（${options.date}）`);
  }
  if (options.newSince !== undefined && !DATE_PATTERN.test(options.newSince)) {
    throw new Error(`newSince は YYYY-MM-DD 形式で指定してください（${options.newSince}）`);
  }
  const schedule = await runScheduleStatus(client, eventId);
  const generatedAt = new Date();
  const news = findNewSessions(eventId, options, generatedAt);
  const html = buildScheduleHtml({
    schedule,
    sessions: options.snapshot,
    profile: options.profile,
    generatedAt,
    options: { date: options.date },
    newSessionIds: news.ids,
    newBaseline: news.baseline,
    lang: options.lang,
    account: options.account,
    digestPeriods: options.dataDir ? buildDigest(eventId, options.dataDir) : undefined,
  });
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, html, 'utf-8');
  return {
    path: options.outPath,
    reserved: schedule.reserved.length,
    favorites: schedule.favorites.length,
    personalTime: schedule.personalTime.length,
  };
}

import type { ApiClient } from '../api/client.js';
import type { Session } from '../api/types.js';
import { loadSnapshot, loadSnapshotByDate, listSnapshotDates } from '../catalog/store.js';
import { computeTrends, type CountChange, type PersonalShare, type TrendsResult } from '../planning/trends.js';
import { runScheduleStatus } from './scheduleStatus.js';

export interface TrendsOptions {
  /** 比べる基準日 "YYYY-MM-DD"（保存済みの日付別スナップショット）。省略時は最も古い日 */
  since?: string;
  keywords?: string[];
  limit?: number;
}

/**
 * カタログの傾向。基準日との比較は日付別スナップショットから、予約・お気に入りとの比較は GetSchedule から取る。
 * サインインできない・取得に失敗したときは、個人との比較だけを省き、理由を notes に書く（傾向そのものは出す）。
 */
export async function runTrends(
  getClient: () => Promise<ApiClient>,
  eventId: string,
  dataDir: string,
  options: TrendsOptions = {},
): Promise<TrendsResult> {
  const current = loadSnapshot(eventId, dataDir);
  if (!current) throw new Error(`ローカルスナップショット（${eventId}）がありません。先に sync を実行してください`);

  const dates = listSnapshotDates(eventId, dataDir); // 新しい順
  const baselineDate = options.since ?? dates[dates.length - 1];
  const baseline = baselineDate ? loadSnapshotByDate(eventId, dataDir, baselineDate) : undefined;
  if (options.since !== undefined && !baseline) {
    throw new Error(`${options.since} のスナップショットが見つかりません。${dates.length > 0 ? `利用可能な日付: ${dates.join(', ')}` : 'まだ記録がありません。'}`);
  }

  let mine: Session[] | undefined;
  let personalNote: string | undefined;
  try {
    const schedule = await runScheduleStatus(await getClient(), eventId);
    const byId = new Map(current.map((s) => [s.sessionId, s]));
    mine = [...new Set([...schedule.reserved, ...schedule.favorites])].map((id) => byId.get(id)).filter((s): s is Session => Boolean(s));
  } catch (err) {
    personalNote = `予約・お気に入りとの比較は省きました（取得できませんでした: ${err instanceof Error ? err.message : String(err)}）。`;
  }

  const result = computeTrends({
    current, baseline, baselineDate: baseline ? baselineDate : undefined, keywords: options.keywords, mine, limit: options.limit,
  });
  if (personalNote) result.notes.push(personalNote);
  return result;
}

const pct = (share: number): string => `${Math.round(share * 1000) / 10}%`;
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

function changeLine(c: CountChange): string {
  const delta = c.delta !== undefined ? `（${signed(c.delta)}）` : '';
  return `  ${c.name}  ${c.count}件 ${pct(c.share)}${delta}`;
}

function personalLine(p: PersonalShare): string {
  return `  ${p.name}  あなた ${pct(p.mineShare)} / 全体 ${pct(p.overallShare)}`;
}

export function formatTrends(r: TrendsResult): string[] {
  const lines: string[] = [];
  lines.push(
    r.baselineDate && r.baselineTotal !== undefined
      ? `全${r.total}件（${r.baselineDate} の ${r.baselineTotal}件から ${signed(r.total - r.baselineTotal)}。新しく載った${r.added}件、消えた${r.removed}件）`
      : `全${r.total}件`,
  );
  const section = <T>(title: string, items: T[], line: (item: T) => string) => {
    if (items.length === 0) return;
    lines.push(title);
    for (const item of items) lines.push(line(item));
  };
  section('話題:', r.topics, changeLine);
  section('サービス:', r.services, changeLine);
  section('形式:', r.types, changeLine);
  section('レベル:', r.levels, changeLine);
  section('日別:', r.days, (c) => `  ${c.name.slice(5)}  ${c.count}件${c.delta !== undefined ? `（${signed(c.delta)}）` : ''}`);
  section('指定した語（タイトル）:', r.keywords, changeLine);
  section('増えたサービス:', r.risingServices, changeLine);
  section('タイトルに増えた語:', r.risingTerms, changeLine);
  if (r.personal) {
    section('あなたの予約・お気に入りが、全体より多い話題:', r.personal.over, personalLine);
    section('あなたの予約・お気に入りが、全体より少ない話題:', r.personal.under, personalLine);
  }
  for (const note of r.notes) lines.push(note);
  return lines;
}

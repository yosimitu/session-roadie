import type { Session } from '../api/types.js';

// カタログの件数から読めること。掲載数は、AWS の注力そのものではない（非公開から公開になっただけで増えることもある）。
// 数えるのは、タイトル・トピック・サービスなど、カタログに書かれている値だけ。

export const DEFAULT_TREND_LIMIT = 10;
const MIN_TERM_COUNT = 5; // 自動で拾う語は、現在これ以上のタイトルに出るものだけ
const MIN_SHARE_FOR_PERSONAL = 0.03; // 自分との比較は、全体の3%以上を占めるトピックだけ

/** タイトルから拾う語から除く。意味の薄い語と、ほぼ全件に出る社名・製品群 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'its', 'of', 'on',
  'or', 'our', 'that', 'the', 'their', 'this', 'to', 'up', 'use', 'using', 'vs', 'what', 'when', 'where', 'why', 'with', 'you',
  'your', 'we', 'us', 'not', 'new', 'more', 'than', 'out', 'over', 'now', 'all', 'any', 'one', 'two', 'has', 'have',
  'aws', 'amazon', 'build', 'building', 'built', 'get', 'getting', 'best', 'ways', 'way', 'every', 'without', 'across', 'via',
  'part', 'session', 'sponsored', 'by',
]);

export interface CountChange {
  name: string;
  count: number;
  /** 全セッションに占める割合（0〜1） */
  share: number;
  /** 基準日の件数。基準日が無いとき、または基準日に無かったときは 0 */
  baselineCount?: number;
  /** 現在 − 基準日 */
  delta?: number;
}

export interface PersonalShare {
  name: string;
  mineShare: number;
  overallShare: number;
  /** mineShare − overallShare。正なら、あなたの予約・お気に入りは全体より、そのトピックが多い */
  diff: number;
}

export interface TrendsInput {
  current: Session[];
  baseline?: Session[];
  baselineDate?: string;
  /** 数えたい語（タイトルに含まれるか。大文字小文字を区別しない） */
  keywords?: string[];
  /** 予約・お気に入りのセッション。あれば全体との違いを出す */
  mine?: Session[];
  limit?: number;
}

export interface TrendsResult {
  total: number;
  baselineDate?: string;
  baselineTotal?: number;
  /** 基準日より増えた/減ったセッション数（sessionId の出入り） */
  added?: number;
  removed?: number;
  topics: CountChange[];
  services: CountChange[];
  types: CountChange[];
  levels: CountChange[];
  days: CountChange[];
  keywords: CountChange[];
  /** 基準日より増えたサービス（増加数の大きい順。基準日があるときだけ） */
  risingServices: CountChange[];
  /** タイトルに出る語のうち、基準日より増えたもの（基準日があるときだけ） */
  risingTerms: CountChange[];
  personal?: { over: PersonalShare[]; under: PersonalShare[] };
  notes: string[];
}

function countBy(sessions: Session[], pick: (s: Session) => (string | undefined)[] | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    for (const key of new Set((pick(s) ?? []).filter((k): k is string => Boolean(k)))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function compare(current: Map<string, number>, baseline: Map<string, number> | undefined, total: number): CountChange[] {
  return [...current.entries()].map(([name, count]) => ({
    name, count, share: total > 0 ? count / total : 0,
    ...(baseline ? { baselineCount: baseline.get(name) ?? 0, delta: count - (baseline.get(name) ?? 0) } : {}),
  }));
}

const byCount = (a: CountChange, b: CountChange) => b.count - a.count || a.name.localeCompare(b.name);
const byDelta = (a: CountChange, b: CountChange) => (b.delta ?? 0) - (a.delta ?? 0) || b.count - a.count || a.name.localeCompare(b.name);

/** タイトルを語に分ける。英数字だけ（"AgentCore" や "s3" は1語）。数字だけの語と短すぎる語、除外語は捨てる */
export function titleTerms(title: string): string[] {
  return [...new Set(
    title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS.has(w)),
  )];
}

function termCounts(sessions: Session[]): Map<string, number> {
  return countBy(sessions, (s) => titleTerms(s.title ?? ''));
}

function keywordCounts(sessions: Session[], keywords: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const k of keywords) {
    const needle = k.toLowerCase();
    counts.set(k, sessions.filter((s) => (s.title ?? '').toLowerCase().includes(needle)).length);
  }
  return counts;
}

export function computeTrends(input: TrendsInput): TrendsResult {
  const limit = input.limit ?? DEFAULT_TREND_LIMIT;
  const { current, baseline } = input;
  const total = current.length;
  const baselineTotal = baseline?.length;
  const notes: string[] = [
    '件数はカタログに載っているセッションの数で、AWS の注力や参加者数を表すものではありません（非公開から公開になっただけで増えることもあります）。',
    '語の数は、タイトルに含まれるかどうかだけを数えています。別の言い方は拾えません。',
  ];
  if (!baseline) notes.push('比べる過去のスナップショットがないため、増減は出していません。sync を毎日続けると、日ごとの変化が取れます。');

  const section = (pick: (s: Session) => (string | undefined)[] | undefined, sort: (a: CountChange, b: CountChange) => number = byCount) =>
    compare(countBy(current, pick), baseline ? countBy(baseline, pick) : undefined, total).sort(sort);

  const services = section((s) => s.services);
  const topics = section((s) => s.topics);
  const types = section((s) => [s.type]);
  // レベルの表記は日によって違う（10/1 は "300 - Advanced"、10/13 は "300 – Advanced"）ので、先頭の3桁で数える
  const levels = section((s) => [s.level?.match(/^\d{3}/)?.[0] ?? 'No Level'], (a, b) => a.name.localeCompare(b.name));
  const days = section((s) => [s.sessionTime?.date], (a, b) => a.name.localeCompare(b.name));

  const keywords = input.keywords?.length
    ? compare(keywordCounts(current, input.keywords), baseline ? keywordCounts(baseline, input.keywords) : undefined, total)
    : [];

  let risingServices: CountChange[] = [];
  let risingTerms: CountChange[] = [];
  let added: number | undefined;
  let removed: number | undefined;
  if (baseline) {
    risingServices = services.filter((c) => (c.delta ?? 0) > 0).sort(byDelta).slice(0, limit);
    risingTerms = compare(termCounts(current), termCounts(baseline), total)
      .filter((c) => c.count >= MIN_TERM_COUNT && (c.delta ?? 0) > 0)
      .sort(byDelta)
      .slice(0, limit);
    const before = new Set(baseline.map((s) => s.sessionId));
    const after = new Set(current.map((s) => s.sessionId));
    added = [...after].filter((id) => !before.has(id)).length;
    removed = [...before].filter((id) => !after.has(id)).length;
  }

  let personal: TrendsResult['personal'];
  if (input.mine && input.mine.length > 0) {
    const mineCounts = countBy(input.mine, (s) => s.topics);
    const overall = new Map(topics.map((t) => [t.name, t.share]));
    const rows: PersonalShare[] = [...overall.entries()]
      .filter(([, share]) => share >= MIN_SHARE_FOR_PERSONAL)
      .map(([name, overallShare]) => {
        const mineShare = (mineCounts.get(name) ?? 0) / input.mine!.length;
        return { name, mineShare, overallShare, diff: mineShare - overallShare };
      });
    personal = {
      over: rows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff || a.name.localeCompare(b.name)).slice(0, 3),
      under: rows.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name)).slice(0, 3),
    };
  }

  return {
    total, baselineDate: input.baselineDate, baselineTotal, added, removed,
    topics: topics.slice(0, limit), services: services.slice(0, limit), types: types.slice(0, limit), levels, days,
    keywords, risingServices, risingTerms, personal, notes,
  };
}

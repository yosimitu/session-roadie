import type { Session } from '../api/types.js';
import { baseAbbreviation } from '../planning/alternatives.js';

// ローカルスナップショットに対する絞り込み。2026-10-01実データでは "agent" がabstractまで含めると
// 2068件中1130件に当たるため、キーワードだけでなくトピック・形式・レベル・日付で絞れるようにする。

export interface CatalogQuery {
  keywords?: string[]; // すべて含む（AND）。大文字小文字は区別しない
  keywordScope?: 'title' | 'titleAndAbstract'; // 既定 titleAndAbstract
  topics?: string[]; // いずれかを含む（OR、完全一致・大文字小文字無視）
  types?: string[]; // 例 "Workshop"（OR、完全一致・大文字小文字無視）
  levels?: string[]; // 例 "300"（先頭一致、OR）
  dates?: string[]; // "YYYY-MM-DD"（OR）
  venues?: string[]; // 部分一致（OR）
  services?: string[]; // 部分一致（OR）
  includeAbstract?: boolean; // 既定false（応答を小さく保つ）
  limit?: number; // 既定50
  offset?: number;
}

export interface CatalogSearchItem {
  sessionId: string;
  abbreviation?: string;
  title: string;
  type?: string;
  level?: string;
  date?: string;
  time?: string;
  length?: string;
  venue?: string;
  topics?: string[];
  repeatSessionIds: string[]; // 同じ元番号を持つ他の回
  abstract?: string;
}

export interface CatalogSearchResult {
  totalCount: number;
  items: CatalogSearchItem[];
}

const DEFAULT_LIMIT = 50;

const lower = (values?: string[]) => values?.map((v) => v.toLowerCase());

function matchesAnyExact(value: string | undefined, wanted?: string[]): boolean {
  if (!wanted?.length) return true;
  return value !== undefined && wanted.includes(value.toLowerCase());
}

function matchesAnyPartial(values: (string | undefined)[], wanted?: string[]): boolean {
  if (!wanted?.length) return true;
  return values.some((v) => v !== undefined && wanted.some((w) => v.toLowerCase().includes(w)));
}

export function searchCatalog(sessions: Session[], query: CatalogQuery): CatalogSearchResult {
  const keywords = lower(query.keywords);
  const topics = lower(query.topics);
  const types = lower(query.types);
  const venues = lower(query.venues);
  const services = lower(query.services);
  const scope = query.keywordScope ?? 'titleAndAbstract';

  const matched = sessions.filter((s) => {
    if (keywords?.length) {
      const text = (scope === 'title' ? s.title : `${s.title} ${s.abstract ?? ''}`).toLowerCase();
      if (!keywords.every((k) => text.includes(k))) return false;
    }
    if (topics?.length && !(s.topics ?? []).some((t) => topics.includes(t.toLowerCase()))) return false;
    if (!matchesAnyExact(s.type, types)) return false;
    if (query.levels?.length && !query.levels.some((l) => s.level?.startsWith(l))) return false;
    if (query.dates?.length && !query.dates.includes(s.sessionTime?.date ?? '')) return false;
    if (!matchesAnyPartial([s.venue], venues)) return false;
    if (!matchesAnyPartial(s.services ?? [], services)) return false;
    return true;
  });

  matched.sort((a, b) => `${a.sessionTime?.date ?? '9'} ${a.sessionTime?.time ?? ''}`.localeCompare(`${b.sessionTime?.date ?? '9'} ${b.sessionTime?.time ?? ''}`));

  const idsByBase = new Map<string, string[]>();
  for (const s of sessions) {
    if (!s.abbreviation) continue;
    const base = baseAbbreviation(s.abbreviation);
    idsByBase.set(base, [...(idsByBase.get(base) ?? []), s.sessionId]);
  }

  const offset = query.offset ?? 0;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const items = matched.slice(offset, offset + limit).map((s): CatalogSearchItem => ({
    sessionId: s.sessionId,
    abbreviation: s.abbreviation,
    title: s.title,
    type: s.type,
    level: s.level,
    date: s.sessionTime?.date,
    time: s.sessionTime?.time,
    length: s.sessionTime?.length,
    venue: s.venue,
    topics: s.topics,
    repeatSessionIds: s.abbreviation ? (idsByBase.get(baseAbbreviation(s.abbreviation)) ?? []).filter((id) => id !== s.sessionId) : [],
    ...(query.includeAbstract ? { abstract: s.abstract } : {}),
  }));

  return { totalCount: matched.length, items };
}

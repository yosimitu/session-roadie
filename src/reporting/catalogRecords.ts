import type { Session } from '../api/types.js';
import { RECOMMEND_THRESHOLD, type Recommendation } from '../planning/recommend.js';

// カタログ全件を、予定表HTMLの「セッション一覧」「全体像」用の軽いレコードにする。
// キーは短く（ページに埋め込むため）。値は後から表示側でエスケープする。

export const STATUS_LABELS = {
  reserved: '予約済み',
  favorite: '公式お気に入り',
  isNew: '新着',
  recommend: 'おすすめ',
  open: '空席あり',
  full: '満席',
  walkUp: '当日先着',
} as const;

export interface CatalogRecord {
  id: string; // sessionId
  c: string; // 略称（無ければ sessionId）
  t: string; // タイトル
  a: string; // abstract
  ty: string; // 形式
  lv: string; // レベル（区切りはハイフンに揃える）
  tp: string[]; // トピック
  rl: string[]; // 役職
  ar: string[]; // 関心分野
  in: string[]; // 業種
  sv: string[]; // サービス
  ft: string[]; // 特徴
  ve: string; // 会場
  rm: string; // 部屋
  dt: string; // 日付（会場PST）
  tm: string; // 開始 "HH:MM"
  ln: number; // 分
  sp: string[]; // 登壇者
  sa?: string; // seatAvailability
  rc?: number; // おすすめ度（0-100）。おすすめの対象になったセッションだけ
  rw?: string[]; // おすすめの理由
  ss: string[]; // 状態（STATUS_LABELS の値）
}

export interface StatusFlags {
  reserved: Set<string>;
  favorites: Set<string>;
  newIds: Set<string>;
}

function statusOf(s: Session, flags: StatusFlags, rec?: Recommendation): string[] {
  const ss: string[] = [];
  const reserved = flags.reserved.has(s.sessionId);
  if (reserved) ss.push(STATUS_LABELS.reserved);
  if (flags.favorites.has(s.sessionId)) ss.push(STATUS_LABELS.favorite);
  if (flags.newIds.has(s.sessionId)) ss.push(STATUS_LABELS.isNew);
  if (rec && rec.score >= RECOMMEND_THRESHOLD) ss.push(STATUS_LABELS.recommend);
  if (!reserved && s.seatAvailability) {
    if (s.seatAvailability === 'unavailable') ss.push(STATUS_LABELS.full);
    else if (s.seatAvailability === 'walkUp') ss.push(STATUS_LABELS.walkUp);
    else ss.push(STATUS_LABELS.open);
  }
  return ss;
}

export function buildCatalogRecords(sessions: Session[], flags: StatusFlags, recs?: Map<string, Recommendation>): CatalogRecord[] {
  return sessions.map((s): CatalogRecord => ({
    id: s.sessionId,
    c: s.abbreviation ?? s.sessionId,
    t: s.title,
    a: s.abstract ?? '',
    ty: s.type ?? '',
    lv: (s.level ?? '').replace(/\s*[–—]\s*/, ' - '),
    tp: s.topics ?? [],
    rl: s.roles ?? [],
    ar: s.areasOfInterest ?? [],
    in: s.industries ?? [],
    sv: s.services ?? [],
    ft: s.features ?? [],
    ve: s.venue ?? '',
    rm: s.room ?? '',
    dt: s.sessionTime?.date ?? '',
    tm: s.sessionTime?.time ?? '',
    ln: Number(s.sessionTime?.length) || 0,
    sp: (s.speakers ?? []).map((sp) => sp.name ?? '').filter(Boolean),
    ...(s.seatAvailability ? { sa: s.seatAvailability } : {}),
    ...(recs?.has(s.sessionId) ? { rc: recs.get(s.sessionId)!.score, rw: recs.get(s.sessionId)!.reasons } : {}),
    ss: statusOf(s, flags, recs?.get(s.sessionId)),
  }));
}

/**
 * `<script type="application/json">` に埋め込めるJSONにする。
 * `<` を \u003c にして `</script>` や `<!--` でタグが閉じたり壊れたりしないようにし、U+2028/2029 もエスケープする。
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
}

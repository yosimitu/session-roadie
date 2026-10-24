import type { PersonalTime, Schedule, SeatAvailability, Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import { findConflicts } from '../commands/conflicts.js';
import { planTravelBlocks } from '../commands/travelBlocks.js';
import { lunchOverlapWarnings } from '../planning/optimize.js';
import { recommendSessions, RECOMMEND_THRESHOLD } from '../planning/recommend.js';
import { normalizeVenue } from '../schedule/travelTime.js';
import { NOTE_REMINDER_TITLE_PREFIX } from '../schedule/noteReminder.js';
import { TRAVEL_BLOCK_DESCRIPTION_MARKER } from '../schedule/travelBlock.js';
import { buildCatalogRecords, serializeForScript } from './catalogRecords.js';
import { CLIENT_SCRIPT } from './catalogClient.js';
import { JA_LABELS } from './jaLabels.js';
import { DIGEST_CSS, renderDigestBody, type DigestPeriod } from './digestHtml.js';
import { CLIENT, PAGE, STATUS, type Lang, type PageStrings } from './i18n.js';

// 現在のスケジュール（予約・お気に入り・個人予定）を日別のタイムラインにし、カタログ全件の一覧・全体像・
// ブラウザ内のメモ候補と合わせて、1枚のHTMLにする。参照専用で、公式の予定の変更や書き込みは行わない。
// 外部のスクリプト・スタイル・画像は読み込まない。
// 時刻はすべて会場現地（PST）。カタログ由来の文字列は必ずエスケープする。

const VENUE_UTC_OFFSET_MS = 8 * 3_600_000;
const PX_PER_MINUTE = 1.2;
const MIN_CARD_MINUTES = 24; // 20分のLightning talkでも文字が読める高さにする
const DEFAULT_DAY_START = 7 * 60; // ★メモ（ブラウザ側で重ねる）が範囲外になりにくいよう広めにとる
const DEFAULT_DAY_END = 21 * 60;
const MINUTES_PER_DAY = 24 * 60;

export interface ScheduleHtmlInput {
  schedule: Schedule;
  sessions: Session[]; // ローカルスナップショット
  profile?: Profile;
  generatedAt: Date;
  options?: { date?: string }; // 指定すると「予定」タブをその日（会場PST）だけにする（一覧・全体像は全件）
  newSessionIds?: string[]; // 「新着」として印を付けるセッション（比較元のスナップショットに無かったもの）
  newBaseline?: string; // 新着の比較元スナップショットの日付（表示用）
  lang?: Lang; // 画面の言語。省略時は日本語（カタログ由来のタイトル・概要は翻訳しない）
  digestPeriods?: DigestPeriod[]; // 「更新履歴」タブ。日別スナップショットの隣り合う日どうしの差分（新しい期間が先）。省略時はタブを出さない
}

const DIGEST_TAB_MAX_PERIODS = 14; // ファイルを重くしないため、タブに載せるのは直近の期間だけ

type Kind = 'reserved' | 'favorite' | 'personal' | 'derived';

interface Tag {
  cls: 'warn' | 'info' | 'seat';
  text: string;
}

interface Item {
  kind: Kind;
  date: string;
  start: number; // 会場現地の0:00からの分
  end: number;
  title: string;
  abbreviation?: string;
  sessionId?: string;
  venue?: string;
  detail: string;
  tags: Tag[];
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pad = (n: number): string => String(n).padStart(2, '0');
const formatMinutes = (min: number): string => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const VENUE_CLASSES: Record<string, string> = {
  MGM: 'mgm',
  Wynn: 'wynn',
  Venetian: 'venetian',
  'Caesars Palace': 'palace',
  'Caesars Forum': 'forum',
};

function sessionRange(s: Session): { date: string; start: number; end: number } | undefined {
  const { date, time, length } = s.sessionTime ?? {};
  if (!date || !time) return undefined;
  const start = toMinutes(time);
  if (Number.isNaN(start)) return undefined;
  return { date, start, end: start + (Number(length) || 30) };
}

/** re:Roadie が書いた移動ブロック・リマインダー（個人予定の日時は、どれも会場の現地時刻のまま保存されている） */
function isRoadieDerived(pt: PersonalTime): boolean {
  return pt.title.startsWith(NOTE_REMINDER_TITLE_PREFIX) || pt.description.includes(TRAVEL_BLOCK_DESCRIPTION_MARKER);
}

function toVenueLocal(iso: string): { date: string; minutes: number } | undefined {
  const local = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(local.getTime())) return undefined;
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

function personalRange(pt: PersonalTime): { date: string; start: number; end: number } | undefined {
  const start = toVenueLocal(pt.startDateTime);
  const end = toVenueLocal(pt.endDateTime);
  if (!start || !end) return undefined;
  return { date: start.date, start: start.minutes, end: end.date === start.date ? end.minutes : MINUTES_PER_DAY };
}

function sessionDetail(s: Session): string {
  return [
    [s.abbreviation, s.title].filter(Boolean).join(' '),
    [s.venue, s.room].filter(Boolean).join(' / '),
    [s.type, s.level].filter(Boolean).join(' / '),
  ].filter(Boolean).join('\n');
}

function buildItems(input: ScheduleHtmlInput, P: PageStrings): { items: Item[]; missing: string[] } {
  const { schedule, sessions, profile } = input;
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const missing: string[] = [];

  const reservedSessions: Session[] = [];
  for (const id of schedule.reserved) {
    const s = byId.get(id);
    if (s && sessionRange(s)) reservedSessions.push(s);
    else missing.push(id);
  }

  const items: Item[] = [];
  const itemFor = new Map<string, Item>();

  for (const s of reservedSessions) {
    const range = sessionRange(s);
    if (!range) continue;
    const item: Item = {
      kind: 'reserved', ...range, title: s.title, abbreviation: s.abbreviation, sessionId: s.sessionId,
      venue: s.venue, detail: sessionDetail(s), tags: [],
    };
    items.push(item);
    itemFor.set(s.sessionId, item);
  }

  const reservedIds = new Set(schedule.reserved);
  for (const id of schedule.favorites) {
    if (reservedIds.has(id)) continue;
    const s = byId.get(id);
    const range = s && sessionRange(s);
    if (!s || !range) continue;
    const tags: Tag[] = [{ cls: 'info', text: P.favoriteTag }];
    if (s.seatAvailability) tags.push({ cls: 'seat', text: P.seat[s.seatAvailability] });
    items.push({
      kind: 'favorite', ...range, title: s.title, abbreviation: s.abbreviation, sessionId: s.sessionId,
      venue: s.venue, detail: sessionDetail(s), tags,
    });
  }

  const personalItems: Item[] = [];
  for (const pt of schedule.personalTime) {
    const range = personalRange(pt);
    if (!range) continue;
    const item: Item = {
      kind: isRoadieDerived(pt) ? 'derived' : 'personal', ...range, title: pt.title,
      detail: [pt.title, pt.location, pt.description].filter(Boolean).join('\n'), tags: [],
    };
    personalItems.push(item);
    items.push(item);
  }

  // 予約同士の時間重複
  for (const group of findConflicts(reservedSessions)) {
    for (const s of group) itemFor.get(s.sessionId)?.tags.push({ cls: 'warn', text: P.overlapTag });
  }

  // 予約と個人予定（基調講演など。re:Roadie が書いたブロックは除く）の重なり
  for (const p of personalItems.filter((x) => x.kind === 'personal')) {
    for (const r of items.filter((x) => x.kind === 'reserved' && x.date === p.date)) {
      if (r.start < p.end && p.start < r.end) r.tags.push({ cls: 'warn', text: P.personalOverlapTag(p.title) });
    }
  }

  // 連続する予約の間で移動時間が足りない
  for (const block of planTravelBlocks(reservedSessions)) {
    if (block.result.sufficient) continue;
    itemFor.get(block.to.sessionId)?.tags.push({
      cls: 'warn',
      text: P.travelShortTag(block.result.neededMinutes, block.result.requiredMinutes, block.result.arrivalBufferMinutes, block.result.availableMinutes),
    });
  }

  // 昼休みにかかる（プロフィールで警告が有効なときだけ）
  if (profile?.lunchBreak) {
    for (const w of lunchOverlapWarnings(reservedSessions)) itemFor.get(w.sessionId)?.tags.push({ cls: 'warn', text: P.lunchTag });
  }

  return { items, missing };
}

interface Placed {
  item: Item;
  lane: number;
  lanes: number;
}

/** 重なる予定を、同じ時間帯のクラスタごとに横へ並べる（クラスタ内の最大の段数で幅を等分する） */
function placeLanes(items: Item[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    const displayEnd = Math.max(item.end, item.start + MIN_CARD_MINUTES);
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(displayEnd);
    } else {
      laneEnds[lane] = displayEnd;
    }
    clusterEnd = Math.max(clusterEnd === -1 ? 0 : clusterEnd, displayEnd);
    cluster.push({ item, lane, lanes: 1 });
  }
  flush();
  return placed;
}

function renderCard(p: Placed, dayStart: number, withoutFavorites?: Placed): string {
  const { item } = p;
  const top = (item.start - dayStart) * PX_PER_MINUTE;
  const height = Math.max(item.end - item.start, MIN_CARD_MINUTES) * PX_PER_MINUTE;
  const width = 100 / p.lanes;
  // 未予約のお気に入りを隠したときの段数・位置（CSSの --l2/--w2 で切り替える）
  const alt = withoutFavorites
    ? `;--l2:${(withoutFavorites.lane * (100 / withoutFavorites.lanes)).toFixed(2)}%;--w2:${(100 / withoutFavorites.lanes).toFixed(2)}%`
    : '';
  const venueClass = item.venue ? VENUE_CLASSES[normalizeVenue(item.venue)] ?? 'other' : 'other';
  const tags = item.tags.map((t) => `<span class="t-tag ${t.cls}">${esc(t.text)}</span>`).join('');
  const meta = item.kind === 'reserved' || item.kind === 'favorite'
    ? `<div class="t-meta">${esc(item.venue ?? '')}</div>`
    : '';
  const sessionAttr = item.sessionId ? ` data-session="${esc(item.sessionId)}"` : '';
  const abbr = item.abbreviation ? `<span class="t-abbr">${esc(item.abbreviation)}</span> ` : '';
  return `<div class="t-card ${item.kind} venue-${venueClass}"${sessionAttr} title="${esc(item.detail)}"`
    + ` style="top:${top.toFixed(1)}px;height:${height.toFixed(1)}px;left:${(p.lane * width).toFixed(2)}%;width:${width.toFixed(2)}%${alt}">`
    + `<div class="t-time">${formatMinutes(item.start)}–${formatMinutes(item.end)}</div>`
    + `<div class="t-ttl">${abbr}${esc(item.title)}</div>${meta}<div class="t-tags">${tags}</div></div>`;
}

// タイムラインの背景に描く時間帯（会場現地）。予定の組み立てや警告には使わない、表示だけの目安
const TIME_BANDS = [
  { cls: 'breakfast', start: 7 * 60, end: 8 * 60 },
  { cls: 'lunch', start: 12 * 60, end: 13 * 60 }, // 昼にかかる回の警告（lunchBreak）と同じ時間帯
  { cls: 'night', start: 18 * 60, end: MINUTES_PER_DAY },
] as const;

function weekdayLabel(date: string, P: PageStrings): string {
  const d = new Date(`${date}T12:00:00Z`);
  return P.weekdayLabel(date.slice(5).replace('-', '/'), P.weekdays[d.getUTCDay()] ?? '');
}

interface Range {
  start: number;
  end: number;
}

function rangeOf(items: Item[]): Range {
  const starts = items.map((i) => i.start);
  const ends = items.map((i) => Math.min(i.end, MINUTES_PER_DAY));
  return {
    start: Math.floor(Math.min(DEFAULT_DAY_START, ...starts) / 60) * 60,
    end: Math.ceil(Math.max(DEFAULT_DAY_END, ...ends) / 60) * 60,
  };
}

/** 1日分の時間軸と予定の枠。.t-memo は、ブラウザ側が★メモを重ねて描く入れ物 */
/** 1時間ごとの線。labels を false にすると時刻の目盛りは付けない（5日間通しの日の列用） */
function hourLines(range: Range, labels: boolean): string {
  const lines: string[] = [];
  for (let m = range.start; m <= range.end; m += 60) {
    const label = labels ? `<span>${pad(m / 60 % 24)}:00</span>` : '';
    lines.push(`<div class="t-hour" style="top:${((m - range.start) * PX_PER_MINUTE).toFixed(1)}px">${label}</div>`);
  }
  return lines.join('');
}

function renderGrid(date: string, items: Item[], range: Range, P: PageStrings, withLabels = true): string {
  const height = (range.end - range.start) * PX_PER_MINUTE;
  const hours = [hourLines(range, withLabels)];
  const withoutFavorites = new Map(placeLanes(items.filter((i) => i.kind !== 'favorite')).map((p) => [p.item, p]));
  const cards = placeLanes(items).map((p) => renderCard(p, range.start, withoutFavorites.get(p.item))).join('');
  // 時間帯の帯（朝食・ランチ・夜）。予定の背後に描き、表示範囲に入る部分だけ出す
  const bands = TIME_BANDS.flatMap((b) => {
    const from = Math.max(b.start, range.start);
    const to = Math.min(b.end, range.end);
    if (to <= from) return [];
    return [`<div class="t-band band-${b.cls}" style="top:${((from - range.start) * PX_PER_MINUTE).toFixed(1)}px;height:${((to - from) * PX_PER_MINUTE).toFixed(1)}px"><span>${P.bands[b.cls]}</span></div>`];
  });
  return `<div class="t-grid" data-date="${esc(date)}" data-start="${range.start}" style="height:${height.toFixed(1)}px">`
    + `${hours.join('')}${bands.join('')}<div class="t-lane">${cards}</div>`
    + `<div class="t-memo" data-date="${esc(date)}" data-start="${range.start}"></div></div>`;
}

function daySummary(items: Item[], P: PageStrings): string {
  const reservedCount = items.filter((i) => i.kind === 'reserved').length;
  const warnCount = items.reduce((n, i) => n + i.tags.filter((t) => t.cls === 'warn').length, 0);
  return P.daySummary(reservedCount, warnCount);
}

function renderDay(date: string, items: Item[], today: string, P: PageStrings): string {
  const badge = date === today ? `<span class="today">${P.today}</span>` : '';
  return `<section class="t-day" id="day-${esc(date)}"><h3>${esc(date)} ${badge}<small>${daySummary(items, P)}</small></h3>`
    + `${renderGrid(date, items, rangeOf(items), P)}</section>`;
}

/** 全日を横に並べる。日をまたいで時刻が揃うよう、時間軸は全日で共通にする */
function renderWeek(dates: string[], byDate: Map<string, Item[]>, today: string, P: PageStrings): string {
  const range = rangeOf(dates.flatMap((d) => byDate.get(d) ?? []));
  const cols = dates.map((d) => {
    const items = byDate.get(d) ?? [];
    const badge = d === today ? `<span class="today">${P.today}</span>` : '';
    return `<div class="w-col" id="w-${esc(d)}"><h4>${esc(weekdayLabel(d, P))} ${badge}<small>${daySummary(items, P)}</small></h4>`
      + `${renderGrid(d, items, range, P, false)}</div>`;
  });
  // 時間スケールは日ごとに重ねず、左端に1本だけ置く（横にスクロールしても残る）
  const axis = `<div class="w-axis"><h4>&nbsp;</h4><div class="t-axis" style="height:${((range.end - range.start) * PX_PER_MINUTE).toFixed(1)}px">${hourLines(range, true)}</div></div>`;
  return `<div class="w-wrap" style="grid-template-columns:44px repeat(${dates.length},minmax(270px,1fr))">${axis}${cols.join('')}</div>`;
}

const STYLE = `
:root{--tx:#2C2C2B;--tx2:#7D7A75;--bg:#fff;--sf:#F9F8F7;--sf2:#F0EFED;--bd:#E6E5E3;--ac:#2783DE;--acs:#E5F2FC;--gr:#46A171;--grs:#E8F1EC;--or:#D5803B;--ors:#FBEBDE;--rd:#E56458;--rds:#FCE9E7;
--memo:#FFF4D6;--v-mgm:#e8f0ff;--v-wynn:#fff1e0;--v-venetian:#e8f7ec;--v-palace:#f6e9ff;--v-forum:#e6f6f8;--v-other:#f1f3f6}
@media (prefers-color-scheme:dark){:root{--tx:#fff;--tx2:rgba(255,255,255,.65);--bg:#191919;--sf:#202020;--sf2:#383836;--bd:rgba(255,255,255,.2);--ac:#5E9FE8;--acs:rgba(94,159,232,.12);--gr:#72BC8F;--grs:rgba(114,188,143,.12);--or:#DE9255;--ors:rgba(222,146,85,.12);--rd:#E97366;--rds:rgba(233,115,102,.12);
--memo:rgba(232,169,59,.18);--v-mgm:#1b2b4a;--v-wynn:#4a3318;--v-venetian:#173a24;--v-palace:#3b2552;--v-forum:#14383d;--v-other:#222a36}}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",Meiryo,sans-serif;color:var(--tx);background:var(--bg)}
button,input,select{font:inherit;color:inherit}
header{padding:24px 32px 16px;border-bottom:1px solid var(--bd)}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--tx2);font-size:14px;margin:0}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
.stat{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:8px 14px;min-width:110px}
.stat b{display:block;font-size:20px}
.stat span{font-size:12px;color:var(--tx2)}
.tabs{display:flex;gap:4px;padding:0 32px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--bg);z-index:5}
.tab{border:0;background:none;padding:12px 14px;cursor:pointer;color:var(--tx2);border-bottom:2px solid transparent;min-height:44px}
.tab.on{color:var(--tx);border-bottom-color:var(--ac);font-weight:600}
.layout{display:grid;grid-template-columns:290px 1fr;gap:0;min-height:80vh}
aside{border-right:1px solid var(--bd);padding:16px;overflow:auto;max-height:calc(100vh - 46px);position:sticky;top:46px}
main{padding:16px 32px 64px;min-width:0}
.view{padding:16px 32px 48px}
.search{width:100%;padding:10px 12px;border:1px solid var(--bd);border-radius:8px;background:var(--bg)}
.search:focus,.mini:focus{outline:2px solid var(--ac);outline-offset:1px}
details.f{border-bottom:1px solid var(--bd);padding:8px 0}
details.f summary{cursor:pointer;font-weight:600;font-size:14px;padding:6px 0;list-style:none;display:flex;justify-content:space-between}
details.f summary::after{content:"＋";color:var(--tx2)}
details.f[open] summary::after{content:"－"}
.badge{background:var(--ac);color:#fff;border-radius:10px;font-size:11px;padding:0 7px;margin-left:6px}
.opts{max-height:260px;overflow:auto;padding:2px 0}
.opt{display:flex;align-items:flex-start;gap:8px;font-size:13px;padding:3px 2px;cursor:pointer;border-radius:4px}
.opt:hover{background:var(--sf)}
.opt input{margin-top:3px}
.opt .en{color:var(--tx2);font-size:11px;display:block}
.opt .n{margin-left:auto;color:var(--tx2);font-size:12px;font-variant-numeric:tabular-nums}
.opt.zero{opacity:.4}
.mini{width:100%;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;margin:4px 0;background:var(--bg);font-size:13px}
.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.toolbar .count{font-weight:600}
.btn{border:1px solid var(--bd);background:var(--bg);border-radius:8px;padding:6px 12px;cursor:pointer;min-height:36px;font-size:13px}
.btn:hover{background:var(--sf)}
.btn.pri{background:var(--ac);border-color:var(--ac);color:#fff}
.btn:focus-visible,.tab:focus-visible,.star:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{background:var(--acs);color:var(--ac);border:0;border-radius:12px;padding:3px 10px;font-size:12px;cursor:pointer}
.card{border:1px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:var(--bg)}
.card:hover{border-color:var(--tx2)}
.card.is-reserved{border-left:4px solid var(--gr)}
.row1{display:flex;gap:10px;align-items:flex-start}
.code{font-family:Menlo,Consolas,monospace;font-size:12px;background:var(--sf2);border-radius:4px;padding:2px 6px;white-space:nowrap}
.title{font-weight:600;font-size:15.5px;margin:0;flex:1}
.title .ja{display:block;font-weight:600}
.title .ja + .orig{display:block;font-weight:400;font-size:13px;color:var(--tx2)}
.star{border:0;background:none;font-size:20px;cursor:pointer;color:var(--tx2);min-width:36px;min-height:36px;border-radius:6px}
.star.on{color:#E8A93B}
.meta{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:13px;color:var(--tx2);margin:6px 0}
.tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.tag{font-size:11.5px;border-radius:4px;padding:1px 7px;background:var(--sf2)}
.tag.ty{background:var(--acs);color:var(--ac)}
.tag.rl{background:var(--grs);color:var(--gr)}
.tag.lv{background:var(--ors);color:var(--or)}
.tag.st-rs{background:var(--gr);color:#fff;font-weight:600}
.tag.st-fv{background:var(--acs);color:var(--ac);font-weight:600}
.tag.st-nw{background:var(--or);color:#fff;font-weight:600}
.tag.st-op{background:var(--grs);color:var(--gr)}
.tag.st-fl{background:var(--rds);color:var(--rd);font-weight:600}
.tag.st-wu{background:var(--sf2);color:var(--tx2)}
.tag.st-rc{background:#7C5CFC;color:#fff;font-weight:600}
.rec{margin-top:8px;font-size:12px;color:var(--tx2)}
.rec b{color:#7C5CFC}
.recipe{margin:0 0 12px;font-size:13px;border:1px solid var(--bd);border-radius:8px;padding:8px 12px}
.recipe summary{cursor:pointer;font-weight:600}
.recipe ul{margin:8px 0 0;padding-left:18px}
.recipe .src{color:var(--tx2);font-size:12px}
.abs{font-size:14px;margin-top:10px;display:none}
.card.open .abs{display:block}
.abs p{margin:6px 0}
.abs .jaabs{background:var(--sf);border-left:3px solid var(--ac);padding:8px 12px;border-radius:4px}
.abs .lbl{font-size:12px;color:var(--tx2);font-weight:600}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.more{display:flex;justify-content:center;margin:16px}
.note{font-size:12px;color:var(--tx2);margin:2px 0}
.empty{padding:48px;text-align:center;color:var(--tx2)}
.ov{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.panel{border:1px solid var(--bd);border-radius:10px;padding:16px}
.panel h3{margin:0 0 12px;font-size:16px}
.bar{display:grid;grid-template-columns:170px 1fr 46px;gap:8px;align-items:center;font-size:13px;margin:4px 0;cursor:pointer}
.bar:hover .lab{color:var(--ac)}
.bar .lab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .tr{background:var(--sf2);border-radius:4px;height:12px;overflow:hidden}
.bar .fl{background:var(--ac);height:100%;border-radius:4px}
.bar .v{text-align:right;font-variant-numeric:tabular-nums;color:var(--tx2)}
.mday{margin-bottom:24px}
.mday h3{font-size:16px;margin:0 0 8px}
.slot{display:grid;grid-template-columns:110px 1fr;gap:12px;border-top:1px solid var(--bd);padding:8px 0;font-size:14px}
.slot.cf{background:var(--rds)}
.warn{color:var(--rd);font-size:12px;font-weight:600}
.warn-text{color:var(--rd);font-weight:600}
.hidden{display:none!important}
.dnav{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 16px}
.dnav a{padding:4px 12px;border:1px solid var(--bd);border-radius:6px;color:var(--tx);text-decoration:none;font-size:13px}
.dnav a.is-today{border-color:var(--ac);color:var(--ac);font-weight:600}
.t-day{max-width:1100px;margin:0 0 28px}
.t-day h3{font-size:16px;margin:0 0 8px}
.t-day h3 small{margin-left:12px;color:var(--tx2);font-weight:400;font-size:12px}
.today{background:var(--ac);color:var(--bg);border-radius:4px;padding:1px 6px;font-size:11px;margin-left:6px}
.t-grid{position:relative;border-top:1px solid var(--bd)}
.t-hour{position:absolute;left:0;right:0;border-top:1px solid var(--bd)}
.t-hour span{position:absolute;left:0;top:-9px;background:var(--bg);color:var(--tx2);font-size:11px;padding-right:4px}
.t-lane{position:absolute;left:52px;right:0;top:0;bottom:0}
.t-card{position:absolute;overflow:hidden;border:1px solid var(--bd);border-left:4px solid var(--ac);border-radius:6px;padding:2px 6px;background:var(--bg);font-size:12px;line-height:1.35}
.t-card .t-time{color:var(--tx2);font-size:11px}
.t-card .t-ttl{font-weight:600}
.t-card .t-abbr{color:var(--tx2);font-weight:400}
.t-card .t-meta{color:var(--tx2);font-size:11px}
.t-tags{margin-top:2px}
.t-tag{display:inline-block;margin:0 4px 2px 0;padding:0 5px;border-radius:4px;border:1px solid currentColor;font-size:11px}
.t-tag.warn{color:var(--rd)}.t-tag.info{color:var(--ac)}.t-tag.seat{color:var(--or)}
.t-card.reserved.venue-mgm{background:var(--v-mgm)}.t-card.reserved.venue-wynn{background:var(--v-wynn)}.t-card.reserved.venue-venetian{background:var(--v-venetian)}
.t-card.reserved.venue-palace{background:var(--v-palace)}.t-card.reserved.venue-forum{background:var(--v-forum)}.t-card.reserved.venue-other{background:var(--v-other)}
.t-card.favorite{border-style:dashed;border-left-style:dashed;opacity:.9}
.t-card.personal{background:var(--sf2);border-left-color:var(--tx2);font-style:italic}
.t-card.derived{background:transparent;border-style:dotted;border-left-color:var(--tx2);color:var(--tx2)}
.missing{max-width:1100px;margin:0 0 16px;padding:8px 12px;border:1px solid var(--bd);border-radius:6px}
.seg{display:inline-flex;gap:0}
.seg .btn{border-radius:0}
.seg .btn:first-child{border-radius:8px 0 0 8px}
.seg .btn:last-child{border-radius:0 8px 8px 0;border-left:0}
.seg .btn.on{background:var(--ac);border-color:var(--ac);color:#fff}
.sched-bar{margin-bottom:8px}
.t-band{position:absolute;left:52px;right:0;pointer-events:none}
.w-col .t-band{left:0}
.t-band span{position:absolute;right:6px;top:2px;font-size:11px;color:var(--tx2)}
.band-breakfast{background:rgba(232,169,59,.13)}
.band-lunch{background:rgba(70,161,113,.13)}
.band-night{background:rgba(99,102,241,.14)}
.t-card[data-session],.t-card.memo{cursor:pointer}
.t-card[data-session]:hover,.t-card.memo:hover{border-color:var(--ac)}
.card.flash{outline:3px solid var(--ac);outline-offset:2px}
.slot .mstar{border:0;background:none;color:#E8A93B;cursor:pointer;font-size:18px;padding:0 4px 0 0;vertical-align:middle}
.linkbtn{border:0;background:none;color:var(--ac);cursor:pointer;font-size:12px;padding:0 0 0 6px}
.linkbtn:hover{text-decoration:underline}
.hide-fav .t-card.favorite{display:none}
.hide-fav .t-card[style*="--l2"]{left:var(--l2)!important;width:var(--w2)!important}
.t-memo{display:none}
.show-memo .t-grid.has-memo .t-lane{right:calc(var(--memo-w,33%) + 1%)}
.show-memo .t-grid.has-memo .t-memo{display:block;position:absolute;top:0;bottom:0;right:0;width:var(--memo-w,33%)}
.t-card.memo{background:var(--memo);border-left-color:#E8A93B;border-style:solid}
.t-card.memo .mstar{position:absolute;top:0;right:2px;border:0;background:none;color:#E8A93B;cursor:pointer;font-size:15px;padding:0 2px}
.t-tag.memo-tag{color:#B7791F}
.t-card.compact .t-meta{display:none}
.t-card.compact{padding:1px 2px;font-size:10px}
.t-card.compact .t-tag{padding:0 2px;margin:0 2px 1px 0}
.w-wrap{display:grid;gap:12px;overflow-x:auto;padding-bottom:8px}
.w-axis{position:sticky;left:0;z-index:3;background:var(--bg)}
.w-axis h4,.w-col h4{height:22px;margin:0 0 6px;overflow:hidden;white-space:nowrap}
.t-axis{position:relative;border-top:1px solid var(--bd)}
.t-axis .t-hour{border-top:0}
.t-axis .t-hour span{font-size:10px}
.w-col h4{font-size:14px;position:sticky;left:0}
.w-col h4 small{margin-left:8px;color:var(--tx2);font-weight:400;font-size:11px}
.w-col .t-lane{left:0}
.w-col .t-card{font-size:11px;padding:1px 4px}
.w-col .t-hour span{font-size:10px}
@media (max-width:820px){.layout{grid-template-columns:1fr}aside{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--bd)}main,header,.view{padding-left:16px;padding-right:16px}.tabs{padding:0 8px;overflow-x:auto}.bar{grid-template-columns:120px 1fr 40px}.t-lane{left:44px}}
`;

export function buildScheduleHtml(input: ScheduleHtmlInput): string {
  const lang = input.lang ?? 'ja';
  const P = PAGE[lang];
  const { items: allItems, missing } = buildItems(input, P);
  const only = input.options?.date;
  const items = only ? allItems.filter((i) => i.date === only) : allItems;
  const today = new Date(input.generatedAt.getTime() - VENUE_UTC_OFFSET_MS).toISOString().slice(0, 10);

  const byDate = new Map<string, Item[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  const catalogDates = input.sessions.map((s) => s.sessionTime?.date).filter((d): d is string => Boolean(d) && (!only || d === only));
  const dates = [...new Set([...byDate.keys(), ...catalogDates])].sort();

  const reservedTotal = items.filter((i) => i.kind === 'reserved').length;
  const favoriteTotal = items.filter((i) => i.kind === 'favorite').length;
  const warnTotal = items.reduce((n, i) => n + i.tags.filter((t) => t.cls === 'warn').length, 0);

  const nav = dates
    .map((d) => `<a href="#day-${esc(d)}"${d === today ? ' class="is-today"' : ''}>${esc(d.slice(5))}</a>`)
    .join('');
  const days = dates.length > 0
    ? dates.map((d) => renderDay(d, byDate.get(d) ?? [], today, P)).join('')
    : `<div class="empty">${P.noSchedule}</div>`;
  const week = dates.length > 0 ? renderWeek(dates, byDate, today, P) : '';
  const missingBlock = missing.length > 0
    ? `<div class="missing">${P.missing(missing.map(esc).join(', '))}</div>`
    : '';

  const personal = allItems
    .filter((i) => i.kind === 'personal')
    .map((i) => ({ date: i.date, start: i.start, end: i.end, title: i.title }));
  // おすすめ: お気に入りの傾向とプロフィールの優先順位から重みを決め、予約・個人予定・空席などの条件で絞る
  const recommendation = recommendSessions({
    sessions: input.sessions,
    reservedIds: input.schedule.reserved,
    favoriteIds: input.schedule.favorites,
    busy: personal,
    profile: input.profile,
    newIds: new Set(input.newSessionIds ?? []),
    lang,
  });
  const records = buildCatalogRecords(input.sessions, {
    reserved: new Set(input.schedule.reserved),
    favorites: new Set(input.schedule.favorites),
    newIds: new Set(input.newSessionIds ?? []),
  }, recommendation.byId, lang);
  const recipe = recommendation.recipe.slice(0, 12).map((r) => ({ t: r.topic, w: Number(r.weight.toFixed(2)), s: r.source, ...(r.rank ? { r: r.rank } : {}) }));
  const embedded = serializeForScript({
    data: records, ja: lang === 'ja' ? JA_LABELS : {}, ui: CLIENT[lang], st: STATUS[lang], lang, meta: { newBaseline: input.newBaseline ?? '', personal, px: PX_PER_MINUTE, recipe, threshold: RECOMMEND_THRESHOLD },
  });

  const digestTab = input.digestPeriods !== undefined;
  const translateButton =P.translateAll ? `<button class="btn pri" id="trBulk">${P.translateAll}</button>\n<span class="note" id="trStatus"></span>\n` : '';
  return `<!doctype html>
<html lang="${P.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${P.title}</title><style>${STYLE}${digestTab ? DIGEST_CSS : ''}</style></head><body>
<header><h1>${P.heading}</h1>
<p class="sub">${P.subtitle}</p>
<div class="stats" id="stats"></div>
<p class="note" id="newNote"></p>
<p class="note">${P.timezoneNote}</p>
<p class="note">${esc(P.created(input.generatedAt.toISOString()))}</p></header>
<nav class="tabs" role="tablist">
<button class="tab on" data-v="sched" role="tab">${P.tabSchedule}</button>
<button class="tab" data-v="list" role="tab">${P.tabList}</button>
<button class="tab" data-v="ov" role="tab">${P.tabOverview}</button>
<button class="tab" data-v="memo" role="tab">${P.tabMemo} <span id="memon"></span></button>
${digestTab ? `<button class="tab" data-v="digest" role="tab">${P.tabDigest}</button>\n` : ''}</nav>
<div id="vsched" class="view">
<div class="note">${P.scheduleSummary(reservedTotal, favoriteTotal, warnTotal)}</div>
<div class="toolbar sched-bar">
<span class="seg"><button class="btn on" data-sv="day">${P.segDay}</button><button class="btn" data-sv="week">${P.segWeek(dates.length)}</button></span>
<label class="opt"><input type="checkbox" id="showFav" checked>${P.showFavorites}</label>
<label class="opt"><input type="checkbox" id="showMemo" checked>${P.showMemo}</label>
<span class="note">${P.scheduleHint}</span>
</div>
${missingBlock}
<div id="vday">${nav ? `<div class="dnav">${nav}</div>` : ''}${days}</div>
<div id="vweek" class="hidden">${week}</div>
</div>
<div class="layout hidden" id="vlist">
<aside>
<input class="search" id="q" type="search" placeholder="${P.searchPlaceholder}" aria-label="${P.searchAria}">
<div style="display:flex;gap:8px;margin:10px 0"><label class="opt" style="flex:1"><input type="checkbox" id="memoOnly">${P.memoOnly}</label><button class="btn" id="clear">${P.clear}</button></div>
<div id="filters"></div>
</aside>
<main>
<div class="toolbar">
<span class="count" id="count"></span>
<label class="note">${P.sortLabel} <select id="sort" class="btn"><option value="time">${P.sortTime}</option><option value="rec">${P.sortRecommend}</option><option value="code">${P.sortCode}</option><option value="level">${P.sortLevel}</option></select></label>
<button class="btn" id="expandAll">${P.expandAll}</button>
${translateButton}</div>
<details class="recipe" id="recipe"></details>
<div class="chips" id="chips"></div>
<div id="list"></div>
<div class="more"><button class="btn hidden" id="moreBtn"></button></div>
</main>
</div>
<div id="vov" class="view hidden"><p class="note" style="margin-top:0">${P.overviewHint}</p><div class="ov" id="ov"></div></div>
<div id="vmemo" class="view hidden">
<div class="toolbar"><span class="count" id="memoCount"></span><button class="btn" id="csv">${P.csvExport}</button><span class="note">${P.memoHint}</span></div>
<div id="memoPlan"></div>
</div>
${digestTab ? `<div id="vdigest" class="view hidden">${renderDigestBody(input.digestPeriods ?? [], lang, DIGEST_TAB_MAX_PERIODS)}</div>\n` : ''}<script type="application/json" id="ri-data">${embedded}</script>
<script>${CLIENT_SCRIPT}</script>
</body></html>
`;
}

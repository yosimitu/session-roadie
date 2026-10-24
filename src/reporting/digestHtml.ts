import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Session } from '../api/types.js';
import { diffCatalog, type CatalogDiff, type ChangedSession } from '../catalog/diff.js';
import { listSnapshotDates, loadSnapshotByDate } from '../catalog/store.js';

/** 隣り合う2つの日別スナップショットの差分 */
export interface DigestPeriod {
  from: string;
  to: string;
  diff: CatalogDiff;
}

const DAY_MS = 86_400_000;

type DigestLang = 'ja' | 'en';

const L = {
  ja: {
    added: '新規', removed: '削除', changed: '変更（会場・部屋・日時）', changedShort: '変更', unit: '件', none: '変化なし',
    noType: '（形式なし）', noValue: '（なし）', period: '期間',
    merged: (n: number) => `${n}日分をまとめた差分（間のスナップショットなし）`,
    empty: '比べられる日別スナップショットが2日分ありません。<code>re-roadie sync</code> か <code>watch</code> を日をあけて実行すると記録されます。',
    field: { venue: '会場', room: '部屋', sessionTime: '日時' } as Record<string, string>,
    caption: '件数はカタログの掲載数で、AWS の注力や参加者数を表すとは限りません。変更は会場・部屋・日時のみ。',
    truncated: (shown: number, all: number) => `直近${shown}期間のみ表示（全${all}期間は re-roadie digest で見られます）`,
    heading: 'カタログの更新履歴',
  },
  en: {
    added: 'New', removed: 'Removed', changed: 'Changed (venue, room, time)', changedShort: 'Changed', unit: '', none: 'No changes',
    noType: '(no type)', noValue: '(none)', period: 'Period',
    merged: (n: number) => `Combined diff over ${n} days (no snapshot in between)`,
    empty: 'Fewer than two daily snapshots are saved. Run <code>re-roadie sync</code> or <code>watch</code> on different days to record them.',
    field: { venue: 'Venue', room: 'Room', sessionTime: 'Time' } as Record<string, string>,
    caption: 'Counts are catalog listings and do not necessarily show AWS priorities or attendance. Changes cover venue, room, and time only.',
    truncated: (shown: number, all: number) => `Showing the latest ${shown} periods only (all ${all} are in re-roadie digest)`,
    heading: 'Catalog update history',
  },
} as const;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * 日別スナップショットを古い順に並べ、隣り合う日どうしの差分を返す（新しい期間が先）。
 * 件数0のスナップショット（取得失敗で空になったもの）は比較に使わない。
 * since を指定すると、その日以降のスナップショットだけを使う（since 当日が基準になる）。
 */
export function buildDigest(eventId: string, dataDir: string, since?: string): DigestPeriod[] {
  const dates = listSnapshotDates(eventId, dataDir).reverse().filter((d) => !since || d >= since);
  const snapshots = dates
    .map((date) => ({ date, sessions: loadSnapshotByDate(eventId, dataDir, date) ?? [] }))
    .filter((s) => s.sessions.length > 0);
  const periods: DigestPeriod[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const [prev, next] = [snapshots[i - 1]!, snapshots[i]!];
    periods.push({ from: prev.date, to: next.date, diff: diffCatalog(prev.sessions, next.sessions) });
  }
  return periods.reverse();
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

function when(s: Session): string {
  const t = s.sessionTime;
  const m = t?.date?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const day = m ? `${Number(m[1])}/${Number(m[2])}` : t?.date;
  return [day, t?.time].filter(Boolean).join(' ');
}

function sessionLine(s: Session): string {
  const meta = [when(s), s.venue, s.room].filter(Boolean).join('、');
  return `<li><b>${esc(s.abbreviation ?? s.sessionId)}</b> ${esc(s.title)}${meta ? ` <span class="meta">${esc(meta)}</span>` : ''}</li>`;
}

function fieldValue(s: Session, field: string, t: (typeof L)[DigestLang]): string {
  if (field === 'sessionTime') return when(s) || t.noValue;
  return String((s as unknown as Record<string, unknown>)[field] ?? t.noValue);
}

function changedLine(c: ChangedSession, t: (typeof L)[DigestLang]): string {
  const parts = c.changedFields.map((f) => `${t.field[f] ?? f}: ${esc(fieldValue(c.before, f, t))} → ${esc(fieldValue(c.after, f, t))}`);
  return `<li><b>${esc(c.after.abbreviation ?? c.sessionId)}</b> ${esc(c.after.title)} <span class="meta">${parts.join(' / ')}</span></li>`;
}

function groupByType(sessions: Session[], noType: string): [string, Session[]][] {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.type ?? noType;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
}

function section(title: string, count: number, body: string, unit: string, open = false): string {
  if (count === 0) return '';
  return `<details${open ? ' open' : ''}><summary>${esc(title)} <span class="count">${count}${unit}</span></summary>${body}</details>`;
}

function renderPeriod(p: DigestPeriod, first: boolean, t: (typeof L)[DigestLang]): string {
  const { added, removed, changed } = p.diff;
  const span = daysBetween(p.from, p.to);
  const note = span > 1 ? `<span class="note">${esc(t.merged(span))}</span>` : '';
  const empty = added.length + removed.length + changed.length === 0;
  const counts = `<span class="chip add">${t.added} ${added.length}</span><span class="chip rem">${t.removed} ${removed.length}</span><span class="chip chg">${t.changedShort} ${changed.length}</span>`;
  const body = empty
    ? `<p class="none">${t.none}</p>`
    : section(t.added, added.length, groupByType(added, t.noType).map(([type, list]) =>
        `<h4>${esc(type)} (${list.length})</h4><ul>${list.map(sessionLine).join('')}</ul>`).join(''), t.unit, first)
      + section(t.removed, removed.length, `<ul>${removed.map(sessionLine).join('')}</ul>`, t.unit)
      + section(t.changed, changed.length, `<ul>${changed.map((c) => changedLine(c, t)).join('')}</ul>`, t.unit);
  return `<section id="d-${esc(p.to)}"><h2>${esc(p.from)} → ${esc(p.to)} ${note}</h2><div class="chips">${counts}</div>${body}</section>`;
}

/** 更新履歴の部品のCSS。色は scheduleHtml の変数名（--tx --tx2 --bd --sf --gr --rd --or）を使い、.dg の中だけに効く */
export const DIGEST_CSS = `
.dg table{border-collapse:collapse;width:100%;margin-bottom:24px;font-size:14px}
.dg th,.dg td{border-bottom:1px solid var(--bd);padding:6px 8px;text-align:left}.dg td.n{text-align:right}
.dg section{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:12px 16px;margin-bottom:16px}
.dg h2{font-size:17px;margin:0 0 6px}.dg h4{margin:12px 0 4px;font-size:13px;color:var(--tx2)}
.dg .note{font-size:12px;font-weight:normal;color:var(--tx2);margin-left:8px}
.dg .chip{display:inline-block;margin-right:8px;font-size:13px;font-weight:600}
.dg .add{color:var(--gr)}.dg .rem{color:var(--rd)}.dg .chg{color:var(--or)}
.dg details{margin-top:8px}.dg summary{cursor:pointer;font-weight:600}.dg .count{color:var(--tx2);font-weight:normal}
.dg ul{margin:6px 0 0;padding-left:20px}.dg li{margin:3px 0}.dg .meta{color:var(--tx2);font-size:13px}.dg .none,.dg .cap{color:var(--tx2);margin:8px 0 12px;font-size:13px}
.dg a{color:inherit}
`;

/** 単体ページ用の色（scheduleHtml と同じ変数名） */
const PAGE_CSS = `
:root{--tx:#1f2328;--tx2:#59636e;--bg:#fff;--sf:#f6f8fa;--bd:#d1d9e0;--gr:#1a7f37;--rd:#cf222e;--or:#9a6700}
@media (prefers-color-scheme:dark){:root{--tx:#e6edf3;--tx2:#9198a1;--bg:#0d1117;--sf:#151b23;--bd:#3d444d;--gr:#3fb950;--rd:#f85149;--or:#d29922}}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 -apple-system,"Hiragino Sans",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--tx2);margin:0 0 20px;font-size:13px}
`;

/** 更新履歴の本体（表と期間ごとの内訳）。view のタブにも単体ページにも使う。max を超える古い期間は省く */
export function renderDigestBody(periods: DigestPeriod[], lang: DigestLang = 'ja', max?: number): string {
  const t = L[lang];
  if (periods.length === 0) return `<div class="dg"><p class="none">${t.empty}</p></div>`;
  const shown = max === undefined ? periods : periods.slice(0, max);
  const rows = shown.map((p) =>
    `<tr><td><a href="#d-${esc(p.to)}">${esc(p.from)} → ${esc(p.to)}</a></td><td class="n add">${p.diff.added.length}</td><td class="n rem">${p.diff.removed.length}</td><td class="n chg">${p.diff.changed.length}</td></tr>`).join('');
  const cut = shown.length < periods.length ? `<p class="cap">${esc(t.truncated(shown.length, periods.length))}</p>` : '';
  return `<div class="dg"><p class="cap">${esc(t.caption)}</p>${cut}<table><thead><tr><th>${t.period}</th><th>${t.added}</th><th>${t.removed}</th><th>${t.changedShort}</th></tr></thead><tbody>${rows}</tbody></table>${shown.map((p, i) => renderPeriod(p, i === 0, t)).join('')}</div>`;
}

export function renderDigestHtml(eventId: string, periods: DigestPeriod[], generatedAt: Date): string {
  const t = L.ja;
  const total = periods.reduce((n, p) => n + p.diff.added.length, 0);
  const created = generatedAt.toISOString().slice(0, 16).replace('T', ' ');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.heading} ${esc(eventId)}</title><style>${PAGE_CSS}${DIGEST_CSS}</style></head><body><main><h1>${t.heading}</h1><p class="sub">${esc(eventId)} ・ 生成 ${esc(created)} UTC ・ ${periods.length}期間 ・ 新規の合計 ${total}件</p>${renderDigestBody(periods)}</main></body></html>`;
}

export function writeDigestHtml(path: string, html: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

/** 保存済みのスナップショットから更新履歴のHTMLを作って書き出し、期間の数を返す */
export function generateDigestFile(eventId: string, dataDir: string, outPath: string, since?: string, now: Date = new Date()): number {
  const periods = buildDigest(eventId, dataDir, since);
  writeDigestHtml(outPath, renderDigestHtml(eventId, periods, now));
  return periods.length;
}

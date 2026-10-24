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

const FIELD_LABEL: Record<string, string> = { venue: '会場', room: '部屋', sessionTime: '日時' };

function fieldValue(s: Session, field: string): string {
  if (field === 'sessionTime') return when(s) || '（なし）';
  return String((s as unknown as Record<string, unknown>)[field] ?? '（なし）');
}

function changedLine(c: ChangedSession): string {
  const parts = c.changedFields.map((f) => `${FIELD_LABEL[f] ?? f}: ${esc(fieldValue(c.before, f))} → ${esc(fieldValue(c.after, f))}`);
  return `<li><b>${esc(c.after.abbreviation ?? c.sessionId)}</b> ${esc(c.after.title)} <span class="meta">${parts.join(' / ')}</span></li>`;
}

function groupByType(sessions: Session[]): [string, Session[]][] {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.type ?? '（形式なし）';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
}

function section(title: string, count: number, body: string, open = false): string {
  if (count === 0) return '';
  return `<details${open ? ' open' : ''}><summary>${esc(title)} <span class="count">${count}件</span></summary>${body}</details>`;
}

function renderPeriod(p: DigestPeriod, first: boolean): string {
  const { added, removed, changed } = p.diff;
  const span = daysBetween(p.from, p.to);
  const note = span > 1 ? `<span class="note">${span}日分をまとめた差分（間のスナップショットなし）</span>` : '';
  const empty = added.length + removed.length + changed.length === 0;
  const counts = `<span class="chip add">新規 ${added.length}</span><span class="chip rem">削除 ${removed.length}</span><span class="chip chg">変更 ${changed.length}</span>`;
  const body = empty
    ? '<p class="none">変化なし</p>'
    : section('新規', added.length, groupByType(added).map(([type, list]) =>
        `<h4>${esc(type)}（${list.length}）</h4><ul>${list.map(sessionLine).join('')}</ul>`).join(''), first)
      + section('削除', removed.length, `<ul>${removed.map(sessionLine).join('')}</ul>`)
      + section('変更（会場・部屋・日時）', changed.length, `<ul>${changed.map(changedLine).join('')}</ul>`);
  return `<section id="d-${esc(p.to)}"><h2>${esc(p.from)} → ${esc(p.to)} ${note}</h2><div class="chips">${counts}</div>${body}</section>`;
}

const STYLE = `
:root{--bg:#fff;--fg:#1f2328;--sub:#59636e;--line:#d1d9e0;--card:#f6f8fa;--add:#1a7f37;--rem:#cf222e;--chg:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--sub:#9198a1;--line:#3d444d;--card:#151b23;--add:#3fb950;--rem:#f85149;--chg:#d29922}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Hiragino Sans",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--sub);margin:0 0 20px;font-size:13px}
table{border-collapse:collapse;width:100%;margin-bottom:28px;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}td.n{text-align:right}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin-bottom:16px}
h2{font-size:17px;margin:0 0 6px}h4{margin:12px 0 4px;font-size:13px;color:var(--sub)}
.note{font-size:12px;font-weight:normal;color:var(--sub);margin-left:8px}
.chip{display:inline-block;margin-right:8px;font-size:13px;font-weight:600}
.add{color:var(--add)}.rem{color:var(--rem)}.chg{color:var(--chg)}
details{margin-top:8px}summary{cursor:pointer;font-weight:600}.count{color:var(--sub);font-weight:normal}
ul{margin:6px 0 0;padding-left:20px}li{margin:3px 0}.meta{color:var(--sub);font-size:13px}.none{color:var(--sub);margin:8px 0 0}
a{color:inherit}
`;

export function renderDigestHtml(eventId: string, periods: DigestPeriod[], generatedAt: Date): string {
  const rows = periods.map((p) =>
    `<tr><td><a href="#d-${esc(p.to)}">${esc(p.from)} → ${esc(p.to)}</a></td><td class="n add">${p.diff.added.length}</td><td class="n rem">${p.diff.removed.length}</td><td class="n chg">${p.diff.changed.length}</td></tr>`).join('');
  const total = periods.reduce((n, p) => n + p.diff.added.length, 0);
  const body = periods.length === 0
    ? '<p class="none">比べられる日別スナップショットが2日分ありません。<code>re-roadie sync</code> か <code>watch</code> を日をあけて実行すると記録されます。</p>'
    : `<table><thead><tr><th>期間</th><th>新規</th><th>削除</th><th>変更</th></tr></thead><tbody>${rows}</tbody></table>${periods.map((p, i) => renderPeriod(p, i === 0)).join('')}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>カタログの更新履歴 ${esc(eventId)}</title><style>${STYLE}</style></head><body><main><h1>カタログの更新履歴</h1><p class="sub">${esc(eventId)} ・ 生成 ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC ・ ${periods.length}期間 ・ 新規の合計 ${total}件。件数はカタログの掲載数で、AWS の注力や参加者数を表すとは限りません。変更は会場・部屋・日時のみ。</p>${body}</main></body></html>`;
}

export function writeDigestHtml(path: string, html: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

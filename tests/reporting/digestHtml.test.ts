import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDigest, renderDigestHtml } from '../../src/reporting/digestHtml.js';
import { saveSnapshot } from '../../src/catalog/store.js';
import type { Session } from '../../src/api/types.js';

const s = (id: string, o: Partial<Session> = {}): Session => ({
  sessionId: id, title: `T-${id}`, abbreviation: id, type: 'Chalk talk', venue: 'Venetian', room: 'R1',
  sessionTime: { date: '2026-12-01', time: '10:00', length: '60', timezone: 'America/Los_Angeles' }, ...o,
});

describe('buildDigest / renderDigestHtml', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'roadie-digest-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('隣り合う日どうしの差分を新しい期間から返し、空のスナップショットは飛ばす', () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    saveSnapshot('e', [], dir, '2026-10-02');
    saveSnapshot('e', [s('1', { room: 'R2' }), s('2')], dir, '2026-10-03');
    saveSnapshot('e', [s('2')], dir, '2026-10-05');
    const periods = buildDigest('e', dir);
    expect(periods.map((p) => `${p.from}→${p.to}`)).toEqual(['2026-10-03→2026-10-05', '2026-10-01→2026-10-03']);
    expect(periods[0]!.diff.removed.map((x) => x.sessionId)).toEqual(['1']);
    expect(periods[1]!.diff.added.map((x) => x.sessionId)).toEqual(['2']);
    expect(periods[1]!.diff.changed[0]!.changedFields).toEqual(['room']);
  });

  it('since 以降だけを使う', () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    saveSnapshot('e', [s('1'), s('2')], dir, '2026-10-02');
    saveSnapshot('e', [s('1'), s('2'), s('3')], dir, '2026-10-03');
    expect(buildDigest('e', dir, '2026-10-02').map((p) => p.to)).toEqual(['2026-10-03']);
  });

  it('HTMLは件数と変更前後を出し、タイトルをエスケープし、間があいた期間に注記する', () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    saveSnapshot('e', [s('1', { room: 'R2' }), s('2', { title: '<script>x</script>' })], dir, '2026-10-04');
    const html = renderDigestHtml('e', buildDigest('e', dir), new Date('2026-10-04T00:00:00Z'));
    expect(html).toContain('新規 1');
    expect(html).toContain('部屋: R1 → R2');
    expect(html).toContain('3日分をまとめた差分');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x');
  });

  it('比べられる日が足りないときは、その旨を出す', () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    expect(renderDigestHtml('e', buildDigest('e', dir), new Date())).toContain('2日分ありません');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiClient } from '../../src/api/client.js';
import type { Session } from '../../src/api/types.js';
import { saveSnapshot } from '../../src/catalog/store.js';
import { runTrends, formatTrends } from '../../src/commands/trendsReport.js';

const s = (id: string, overrides: Partial<Session> = {}): Session => ({
  sessionId: id, title: `Title ${id}`, topics: ['AI'], services: ['Bedrock'], type: 'Workshop', level: '300 – Advanced',
  sessionTime: { date: '2026-12-02', time: '09:00', length: '60' }, ...overrides,
});

const client = (schedule: { reserved: string[]; favorites: string[] }) =>
  ({ get: async () => ({ schedule: { ...schedule, personalTime: [] } }) }) as unknown as ApiClient;

describe('runTrends', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'roadie-trends-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('スナップショットが無ければ、sync を促す', async () => {
    await expect(runTrends(async () => client({ reserved: [], favorites: [] }), 'e', dir)).rejects.toThrow('sync');
  });

  it('基準日を省くと、最も古い日付別スナップショットと比べる', async () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    saveSnapshot('e', [s('1'), s('2')], dir, '2026-10-07');
    saveSnapshot('e', [s('1'), s('2'), s('3')], dir, '2026-10-13');
    const r = await runTrends(async () => client({ reserved: [], favorites: [] }), 'e', dir);
    expect(r).toMatchObject({ total: 3, baselineDate: '2026-10-01', baselineTotal: 1, added: 2, removed: 0 });
  });

  it('基準日を指定でき、無い日付なら利用可能な日付を示して失敗する', async () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    saveSnapshot('e', [s('1'), s('2')], dir, '2026-10-07');
    const r = await runTrends(async () => client({ reserved: [], favorites: [] }), 'e', dir, { since: '2026-10-07' });
    expect(r.baselineDate).toBe('2026-10-07');
    await expect(runTrends(async () => client({ reserved: [], favorites: [] }), 'e', dir, { since: '2026-09-01' })).rejects.toThrow('2026-10-07');
  });

  it('0件の日のスナップショットは基準にしない（既定は0件でない最も古い日、指定すると理由つきで失敗する）', async () => {
    saveSnapshot('e', [], dir, '2026-10-01');
    saveSnapshot('e', [s('1')], dir, '2026-10-07');
    saveSnapshot('e', [s('1'), s('2')], dir, '2026-10-13');
    const getClient = async () => client({ reserved: [], favorites: [] });
    const r = await runTrends(getClient, 'e', dir);
    expect(r).toMatchObject({ baselineDate: '2026-10-07', baselineTotal: 1, added: 1 });
    await expect(runTrends(getClient, 'e', dir, { since: '2026-10-01' })).rejects.toThrow('0件のため');
    await expect(runTrends(getClient, 'e', dir, { since: '2026-10-01' })).rejects.toThrow('利用可能な日付: 2026-10-13, 2026-10-07');
  });

  it('基準にできる日が現在の1日分しかなければ、増減は出さない', async () => {
    saveSnapshot('e', [], dir, '2026-10-01');
    saveSnapshot('e', [s('1')], dir, '2026-10-13');
    const r = await runTrends(async () => client({ reserved: [], favorites: [] }), 'e', dir);
    // 最新（2026-10-13）自身が最も古い使える日になるので、差は0
    expect(r.baselineDate).toBe('2026-10-13');
    expect(r).toMatchObject({ added: 0, removed: 0 });
  });

  it('サインインできなくても傾向は返し、個人との比較を省いた理由を注記する', async () => {
    saveSnapshot('e', [s('1')], dir, '2026-10-01');
    const r = await runTrends(async () => { throw new Error('未サインイン'); }, 'e', dir);
    expect(r.total).toBe(1);
    expect(r.personal).toBeUndefined();
    expect(r.notes.join()).toContain('未サインイン');
  });

  it('予約・お気に入りがあれば、全体との違いを出す', async () => {
    const all = [s('a', { topics: ['AI'] }), s('b', { topics: ['AI'] }), s('c', { topics: ['AI'] }), s('d', { topics: ['Security'] })];
    saveSnapshot('e', all, dir, '2026-10-01');
    const r = await runTrends(async () => client({ reserved: ['d'], favorites: ['d'] }), 'e', dir);
    expect(r.personal?.over.map((p) => p.name)).toEqual(['Security']);
  });
});

describe('formatTrends', () => {
  it('基準日なしの表示は、増減を付けず、過去が無い旨を注記する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadie-trends-fmt-'));
    try {
      saveSnapshot('e', [s('1')], dir, '2026-10-13');
      const r = await runTrends(async () => { throw new Error('x'); }, 'e', dir);
      const text = formatTrends({ ...r, baselineDate: undefined, baselineTotal: undefined, added: undefined, removed: undefined }).join('\n');
      expect(text).toContain('全1件');
      expect(text).toContain('AI  1件 100%');
      expect(text).not.toContain('（+');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('基準日ありの表示は、件数の増減と出入りを先頭に出す', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadie-trends-fmt-'));
    try {
      saveSnapshot('e', [s('1')], dir, '2026-10-01');
      saveSnapshot('e', [s('1'), s('2')], dir, '2026-10-13');
      const r = await runTrends(async () => { throw new Error('x'); }, 'e', dir);
      const lines = formatTrends(r);
      expect(lines[0]).toBe('全2件（2026-10-01 の 1件から +1。新しく載った1件、消えた0件）');
      expect(lines.join('\n')).toContain('Bedrock  2件 100%（+1）');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

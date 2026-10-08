import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScheduleView } from '../../src/commands/scheduleView.js';
import { saveSnapshot } from '../../src/catalog/store.js';
import type { ApiClient } from '../../src/api/client.js';
import type { Schedule, Session } from '../../src/api/types.js';

const sessions: Session[] = [
  { sessionId: 'a', abbreviation: 'AIM101', title: 'Agents 101', venue: 'MGM Grand', sessionTime: { date: '2026-11-30', time: '08:30', length: '60' } },
  { sessionId: 'f', abbreviation: 'AIM200', title: 'Fav talk', venue: 'Venetian', sessionTime: { date: '2026-12-01', time: '10:00', length: '60' } },
];
const schedule: Schedule = { reserved: ['a'], favorites: ['f'], personalTime: [] };

function fakeClient(): ApiClient {
  return { get: async () => ({ schedule }) } as unknown as ApiClient;
}

describe('runScheduleView', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'roadie-view-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('GetScheduleとスナップショットからHTMLを書き出し、件数と出力先を返す', async () => {
    const outPath = join(dir, 'nested', 'schedule.html');
    const result = await runScheduleView(fakeClient(), 'reinvent2026', { snapshot: sessions, outPath });

    expect(result).toEqual({ path: outPath, reserved: 1, favorites: 1, personalTime: 0 });
    const html = readFileSync(outPath, 'utf-8');
    expect(html).toContain('Agents 101');
    expect(html).toContain('Fav talk');
  });

  it('date を指定するとその日だけを書き出す', async () => {
    const outPath = join(dir, 'day.html');
    await runScheduleView(fakeClient(), 'reinvent2026', { snapshot: sessions, outPath, date: '2026-11-30' });

    // 「予定」タブは指定した日だけ。一覧・全体像のためのカタログ全件は、日付に関係なく埋め込む
    const html = readFileSync(outPath, 'utf-8');
    expect(html).toContain('id="day-2026-11-30"');
    expect(html).not.toContain('id="day-2026-12-01"');
    expect(html).toContain('Fav talk');
  });

  it('date の形式が YYYY-MM-DD でなければエラー', async () => {
    await expect(runScheduleView(fakeClient(), 'reinvent2026', { snapshot: sessions, outPath: join(dir, 'x.html'), date: '12/1' }))
      .rejects.toThrow('YYYY-MM-DD');
  });

  describe('新着の判定（比較元のスナップショット）', () => {
    const newSession: Session = { sessionId: 'n', abbreviation: 'AIM300', title: 'Brand new', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } };
    const embedded = (path: string) => {
      const html = readFileSync(path, 'utf-8');
      const json = html.split('id="ri-data">')[1].split('</script>')[0];
      return JSON.parse(json) as { data: { id: string; ss: string[] }[]; meta: { newBaseline: string } };
    };

    it('保存済みの日付別スナップショットのうち、今日より前で最新のものを比較元にして、無かったセッションを新着にする', async () => {
      saveSnapshot('reinvent2026', sessions, dir, '2000-01-01');
      const outPath = join(dir, 'new.html');
      await runScheduleView(fakeClient(), 'reinvent2026', { snapshot: [...sessions, newSession], outPath, dataDir: dir });

      const data = embedded(outPath);
      expect(data.meta.newBaseline).toBe('2000-01-01');
      expect(data.data.find((r) => r.id === 'n')?.ss).toContain('新着');
      expect(data.data.find((r) => r.id === 'a')?.ss).not.toContain('新着');
    });

    it('newSince を指定すると、その日のスナップショットとの差分を新着にする', async () => {
      saveSnapshot('reinvent2026', sessions, dir, '2000-01-01');
      saveSnapshot('reinvent2026', [...sessions, newSession], dir, '2000-01-02');
      const outPath = join(dir, 'since.html');
      await runScheduleView(fakeClient(), 'reinvent2026', { snapshot: [...sessions, newSession], outPath, dataDir: dir, newSince: '2000-01-01' });
      expect(embedded(outPath).meta.newBaseline).toBe('2000-01-01');
      expect(embedded(outPath).data.find((r) => r.id === 'n')?.ss).toContain('新着');
    });

    it('比較元が無ければ新着なし（比較元の日付も空）', async () => {
      const outPath = join(dir, 'none.html');
      await runScheduleView(fakeClient(), 'reinvent2026', { snapshot: [...sessions, newSession], outPath, dataDir: dir });
      const data = embedded(outPath);
      expect(data.meta.newBaseline).toBe('');
      expect(data.data.every((r) => !r.ss.includes('新着'))).toBe(true);
    });

    it('newSince のスナップショットが保存されていなければエラー', async () => {
      await expect(runScheduleView(fakeClient(), 'reinvent2026', { snapshot: sessions, outPath: join(dir, 'x.html'), dataDir: dir, newSince: '1999-01-01' }))
        .rejects.toThrow('1999-01-01');
    });
  });
});

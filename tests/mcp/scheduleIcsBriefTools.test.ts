import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Session } from '../../src/api/types.js';

// 出力先は固定なので、実際の data/schedule.ics を上書きしないよう、一時ディレクトリに差し替える
vi.mock('../../src/runtimeContext.js', async (importOriginal) => {
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  return {
    ...(await importOriginal<typeof import('../../src/runtimeContext.js')>()),
    createClient: vi.fn(),
    SCHEDULE_ICS_PATH: join(tmpdir(), 'roadie-mcp-ics-test', 'schedule.ics'),
  };
});

vi.mock('../../src/catalog/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/catalog/store.js')>()),
  loadSnapshot: vi.fn(),
}));

import { createClient, SCHEDULE_ICS_PATH } from '../../src/runtimeContext.js';
import { loadSnapshot } from '../../src/catalog/store.js';
import { dayBriefTool, scheduleIcsTool } from '../../src/mcp/tools.js';

const sessions: Session[] = [
  { sessionId: 'a', abbreviation: 'AIM101', title: 'Agents 101', venue: 'Venetian', room: 'Room 1', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } },
  { sessionId: 'b', abbreviation: 'AIM102', title: 'Second', venue: 'Wynn/Encore', room: 'Room 2', sessionTime: { date: '2026-12-02', time: '11:10', length: '60' } },
  { sessionId: 'f', abbreviation: 'AIM200', title: 'Fav talk', venue: 'Venetian', sessionTime: { date: '2026-12-03', time: '10:00', length: '60' } },
];

function mockSchedule(reserved: string[], favorites: string[] = []) {
  const get = vi.fn().mockResolvedValue({ schedule: { reserved, favorites, personalTime: [] } });
  vi.mocked(createClient).mockResolvedValue({ get } as never);
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(loadSnapshot).mockReset();
  vi.mocked(loadSnapshot).mockReturnValue(sessions);
});

afterAll(() => rmSync(dirname(SCHEDULE_ICS_PATH), { recursive: true, force: true }));

describe('scheduleIcsTool', () => {
  it('予約を固定の出力先に .ics として書き出し、件数と出せなかったIDを返す', async () => {
    mockSchedule(['a', 'ghost'], ['f']);
    const out = await scheduleIcsTool();

    expect(out).toEqual({ path: SCHEDULE_ICS_PATH, events: 1, skipped: ['ghost'] });
    expect(existsSync(SCHEDULE_ICS_PATH)).toBe(true);
    const text = readFileSync(SCHEDULE_ICS_PATH, 'utf-8');
    expect(text).toContain('SUMMARY:AIM101 Agents 101');
    expect(text).not.toContain('Fav talk');
  });

  it('favorites が true のときは、未予約のお気に入りも含める', async () => {
    mockSchedule(['a'], ['f']);
    const out = await scheduleIcsTool(true);
    expect(out.events).toBe(2);
    expect(readFileSync(SCHEDULE_ICS_PATH, 'utf-8')).toContain('STATUS:TENTATIVE');
  });

  it('スナップショットが無ければ、catalog_sync を促すエラー', async () => {
    vi.mocked(loadSnapshot).mockReturnValue(null as never);
    mockSchedule(['a']);
    await expect(scheduleIcsTool()).rejects.toThrow('catalog_sync');
  });
});

describe('dayBriefTool', () => {
  it('date を指定すると、その日の予約の要約と表示用の行を返す', async () => {
    mockSchedule(['b', 'a']);
    const out = await dayBriefTool('2026-12-02');

    expect(out).toMatchObject({
      found: true,
      date: '2026-12-02',
      brief: {
        sessions: [{ sessionId: 'a' }, { sessionId: 'b' }],
        moves: [{ toSessionId: 'b', sufficient: false, neededMinutes: 25, availableMinutes: 10 }],
      },
    });
    expect(out.lines.join('\n')).toContain('⚠ 移動 Venetian → Wynn/Encore');
  });

  it('今日以降に予約が無ければ found: false', async () => {
    vi.mocked(loadSnapshot).mockReturnValue([
      { sessionId: 'old', title: 'old', venue: 'Venetian', sessionTime: { date: '2020-01-01', time: '10:00', length: '60' } },
    ]);
    mockSchedule(['old']);
    expect(await dayBriefTool()).toEqual({ found: false, lines: ['今日以降の予約はありません'] });
  });

  it('date の形式が違えばエラー', async () => {
    mockSchedule(['a']);
    await expect(dayBriefTool('12/2')).rejects.toThrow('YYYY-MM-DD');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiClient } from '../../src/api/client.js';
import type { Session } from '../../src/api/types.js';
import { saveSnapshot } from '../../src/catalog/store.js';
import {
  parseVenueLocalTime, runNowGo, runSeatForecast, runDetour, formatNowGo, formatForecast, formatDetours,
} from '../../src/commands/insights.js';

const s = (id: string, time: string, seat: Session['seatAvailability'], topics: string[] = ['Other']): Session => ({
  sessionId: id, title: `T-${id}`, abbreviation: id.toUpperCase(), venue: 'Venetian', seatAvailability: seat, topics,
  sessionTime: { date: '2026-12-02', time, length: '60' },
});

function fakeClient(schedule: { reserved: string[]; favorites: string[] }): ApiClient {
  return { get: async () => ({ schedule: { ...schedule, personalTime: [] } }) } as unknown as ApiClient;
}

describe('parseVenueLocalTime', () => {
  it('会場の現地時刻を実際の時刻にする（UTC-8）', () => {
    expect(parseVenueLocalTime('2026-12-02 10:30')?.toISOString()).toBe('2026-12-02T18:30:00.000Z');
    expect(parseVenueLocalTime('2026-12-02T09:05')?.toISOString()).toBe('2026-12-02T17:05:00.000Z');
  });
  it('読めない形や範囲外は undefined', () => {
    for (const bad of ['', '2026-12-02', '10:30', '2026-13-02 10:30', '2026-12-02 25:00', '2026-12-02 10:61']) {
      expect(parseVenueLocalTime(bad)).toBeUndefined();
    }
  });
});

describe('insights runners', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'roadie-insights-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('スナップショットが無ければ、sync を促す', async () => {
    await expect(runNowGo(fakeClient({ reserved: [], favorites: [] }), 'e', dir, undefined)).rejects.toThrow('sync');
  });

  it('runNowGo: 予約を除き、現在地を予約から推定して、表示用の行を作る', async () => {
    saveSnapshot('e', [s('mine', '09:00', 'available'), s('next', '10:15', 'limited')], dir, '2026-10-13');
    const result = await runNowGo(fakeClient({ reserved: ['mine'], favorites: ['next'] }), 'e', dir, undefined, {
      now: parseVenueLocalTime('2026-12-02 10:00'),
    });
    expect(result.currentVenue).toBe('Venetian');
    expect(result.items.map((i) => i.sessionId)).toEqual(['next']);
    const lines = formatNowGo(result);
    expect(lines[0]).toContain('現地時刻 2026-12-02 10:00');
    expect(lines.join('\n')).toContain('T-next');
    expect(lines.join('\n')).toContain('お気に入り');
  });

  it('runSeatForecast: 履歴の最新の観測を、カタログの空席表示に上書きして使う', async () => {
    saveSnapshot('e', [s('a', '09:00', 'available')], dir, '2026-10-07');
    saveSnapshot('e', [s('a', '09:00', 'limited')], dir, '2026-10-10'); // sync の最新
    // watch がもっと新しい観測を持っている想定: 履歴ファイルに 10-13 を足す
    const { recordSeatHistory } = await import('../../src/catalog/seatHistory.js');
    recordSeatHistory('e', [s('a', '09:00', 'veryLimited')], dir, '2026-10-13');

    const result = await runSeatForecast(fakeClient({ reserved: [], favorites: [] }), 'e', dir, undefined);
    expect(result.urgent[0]).toMatchObject({ sessionId: 'a', seatAvailability: 'veryLimited' });
    const lines = formatForecast(result).join('\n');
    expect(lines).toContain('近いうちに埋まりそう');
    expect(lines).toContain('満席まで約');
  });

  it('formatForecast: 履歴が足りないときは該当なしと注記を出す', () => {
    const lines = formatForecast({ observationDates: [], horizonDays: 14, urgent: [], hidden: [], freeing: [], notes: ['履歴が足りません'] });
    expect(lines.join('\n')).toContain('該当するセッションはありません');
    expect(lines.join('\n')).toContain('履歴が足りません');
  });

  it('runDetour: 予約のある日について提案し、関心の強さを表示する', async () => {
    saveSnapshot('e', [s('mine', '09:00', 'available', ['Security']), s('far', '11:00', 'available', ['Game Tech'])], dir, '2026-10-13');
    const result = await runDetour(fakeClient({ reserved: ['mine'], favorites: [] }), 'e', dir, undefined);
    expect(result.days[0].candidates.map((c) => c.sessionId)).toEqual(['far']);
    const lines = formatDetours(result).join('\n');
    expect(lines).toContain('12/2:');
    expect(lines).toContain('関心の外: Game Tech');
  });
});

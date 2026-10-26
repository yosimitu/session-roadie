import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScheduleIcs } from '../../src/commands/scheduleIcs.js';
import type { ApiClient } from '../../src/api/client.js';
import type { Schedule, Session } from '../../src/api/types.js';

const sessions: Session[] = [
  { sessionId: 'a', abbreviation: 'AIM101', title: 'Agents 101', venue: 'MGM Grand', sessionTime: { date: '2026-11-30', time: '08:30', length: '60' } },
  { sessionId: 'f', abbreviation: 'AIM200', title: 'Fav talk', venue: 'Venetian', sessionTime: { date: '2026-12-01', time: '10:00', length: '60' } },
];
const schedule: Schedule = { reserved: ['a', 'ghost'], favorites: ['f'], personalTime: [] };

const fakeClient = (): ApiClient => ({ get: async () => ({ schedule }) }) as unknown as ApiClient;

describe('runScheduleIcs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'roadie-ics-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('GetScheduleとスナップショットから .ics を書き出し、件数・出せなかったIDを返す', async () => {
    const outPath = join(dir, 'nested', 'schedule.ics');
    const result = await runScheduleIcs(fakeClient(), 'reinvent2026', { snapshot: sessions, outPath });

    expect(result).toEqual({ path: outPath, events: 1, skipped: ['ghost'] });
    const text = readFileSync(outPath, 'utf-8');
    expect(text).toContain('SUMMARY:AIM101 Agents 101');
    expect(text).not.toContain('Fav talk');
  });

  it('favorites を指定すると、未予約のお気に入りも含める', async () => {
    const outPath = join(dir, 'fav.ics');
    const result = await runScheduleIcs(fakeClient(), 'reinvent2026', { snapshot: sessions, outPath, favorites: true });
    expect(result.events).toBe(2);
    expect(readFileSync(outPath, 'utf-8')).toContain('Fav talk');
  });
});

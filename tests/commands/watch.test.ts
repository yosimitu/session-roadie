import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWatchOnce } from '../../src/commands/watch.js';
import { loadWatchState } from '../../src/catalog/watchState.js';
import type { ApiClient } from '../../src/api/client.js';
import type { Profile } from '../../src/profile/profileStore.js';
import type { Session } from '../../src/api/types.js';

function s(id: string, overrides: Partial<Session> = {}): Session {
  return {
    sessionId: id, title: `T-${id}`, abbreviation: `AB${id}`, venue: 'Venetian',
    sessionTime: { date: '2026-12-02', time: '10:00', length: '60' }, ...overrides,
  };
}

/** 呼び出しごとに、指定した一覧・予定を返す偽のクライアント */
function fakeClient(sessions: () => Session[], schedule: { reserved: string[]; favorites: string[] }): ApiClient {
  const get = async (path: string) => {
    if (path.endsWith('/schedule')) return { schedule: { ...schedule, personalTime: [] } };
    const items = sessions();
    return { items, totalCount: items.length };
  };
  return { get } as unknown as ApiClient;
}

describe('runWatchOnce', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'roadie-watch-cmd-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const noProfile: Profile | undefined = undefined;
  const now = new Date('2026-10-11T12:00:00Z');

  it('初回は基準を保存するだけで、イベントを返さない', async () => {
    const client = fakeClient(() => [s('1', { seatAvailability: 'unavailable' })], { reserved: [], favorites: ['1'] });
    const result = await runWatchOnce(client, 'reinvent2026', dir, noProfile, now);
    expect(result).toMatchObject({ status: 'baseline', sessionCount: 1, events: [] });
    expect(loadWatchState('reinvent2026', dir)?.sessions['1']?.seat).toBe('unavailable');
  });

  it('2回目は前回との差でイベントを返し、状態を更新する', async () => {
    let seat: Session['seatAvailability'] = 'unavailable';
    const client = fakeClient(() => [s('1', { seatAvailability: seat })], { reserved: [], favorites: ['1'] });
    await runWatchOnce(client, 'reinvent2026', dir, noProfile, now);
    seat = 'limited';
    const result = await runWatchOnce(client, 'reinvent2026', dir, noProfile, now);
    expect(result.status).toBe('checked');
    expect(result.events.map((e) => e.kind)).toEqual(['seatOpened']);
    expect(loadWatchState('reinvent2026', dir)?.sessions['1']?.seat).toBe('limited');
  });

  it('カタログが0件のときは、状態を作らず・更新せず・スケジュールも取らない', async () => {
    let scheduleCalled = false;
    const get = async (path: string) => {
      if (path.endsWith('/schedule')) { scheduleCalled = true; return { schedule: { reserved: [], favorites: [], personalTime: [] } }; }
      return { items: [], totalCount: 0 };
    };
    const result = await runWatchOnce({ get } as unknown as ApiClient, 'reinvent2026', dir, noProfile, now);
    expect(result).toEqual({ status: 'empty', sessionCount: 0, events: [] });
    expect(existsSync(join(dir, 'watch-state-reinvent2026.json'))).toBe(false);
    expect(scheduleCalled).toBe(false);
  });

  it('既存の状態があるとき、0件では状態を更新しない', async () => {
    const client1 = fakeClient(() => [s('1', { seatAvailability: 'unavailable' })], { reserved: [], favorites: [] });
    await runWatchOnce(client1, 'reinvent2026', dir, noProfile, now);
    const before = loadWatchState('reinvent2026', dir);
    const client2 = fakeClient(() => [], { reserved: [], favorites: [] });
    await runWatchOnce(client2, 'reinvent2026', dir, noProfile, new Date('2026-10-12T00:00:00Z'));
    expect(loadWatchState('reinvent2026', dir)).toEqual(before);
  });

  it('新着は、プロフィールの条件（希望レベル・スポンサー除外・関心テーマ・参加日）で絞る', async () => {
    const profile: Profile = {
      maxLevel: 300, excludeSponsored: true, interestTopics: ['Security'], attendance: { firstDay: '2026-12-02', lastDay: '2026-12-03' },
    };
    let extra: Session[] = [];
    const base = [s('old', { topics: ['Security'] })];
    const client = fakeClient(() => [...base, ...extra], { reserved: [], favorites: [] });
    await runWatchOnce(client, 'reinvent2026', dir, profile, now);
    extra = [
      s('ok', { topics: ['Security'], level: '300 - Advanced' }),
      s('high', { topics: ['Security'], level: '400 - Expert' }),
      s('sponsor', { topics: ['Security'], abbreviation: 'SEC1-S' }),
      s('topic', { topics: ['Compute'] }),
      s('day', { topics: ['Security'], sessionTime: { date: '2026-12-01', time: '10:00', length: '60' } }),
    ];
    const result = await runWatchOnce(client, 'reinvent2026', dir, profile, now);
    expect(result.events.map((e) => e.kind === 'newMatching' && e.session.sessionId)).toEqual(['ok']);
  });

  it('関心テーマが未設定なら、テーマでは絞らない', async () => {
    let extra: Session[] = [];
    const client = fakeClient(() => [s('old'), ...extra], { reserved: [], favorites: [] });
    await runWatchOnce(client, 'reinvent2026', dir, { maxLevel: 300 }, now);
    extra = [s('new1', { topics: ['Compute'] })];
    const result = await runWatchOnce(client, 'reinvent2026', dir, { maxLevel: 300 }, now);
    expect(result.events.map((e) => e.kind)).toEqual(['newMatching']);
  });
  it('前回10件→今回4件のときは、状態を更新せず・スケジュールも取らず shrunk を返す', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(i));
    await runWatchOnce(fakeClient(() => ids.map((i) => s(i)), { reserved: [], favorites: [] }), 'reinvent2026', dir, noProfile, now);
    const before = loadWatchState('reinvent2026', dir);
    let scheduleCalled = false;
    const get = async (path: string) => {
      if (path.endsWith('/schedule')) { scheduleCalled = true; return { schedule: { reserved: [], favorites: [], personalTime: [] } }; }
      const items = ids.slice(0, 4).map((i) => s(i));
      return { items, totalCount: items.length };
    };
    const result = await runWatchOnce({ get } as unknown as ApiClient, 'reinvent2026', dir, noProfile, new Date('2026-10-12T00:00:00Z'));
    expect(result).toEqual({ status: 'shrunk', sessionCount: 4, events: [] });
    expect(loadWatchState('reinvent2026', dir)).toEqual(before);
    expect(scheduleCalled).toBe(false);
  });

  it('前回10件→今回5件（ちょうど50%）は通常どおり checked', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(i));
    await runWatchOnce(fakeClient(() => ids.map((i) => s(i)), { reserved: [], favorites: [] }), 'reinvent2026', dir, noProfile, now);
    const result = await runWatchOnce(fakeClient(() => ids.slice(0, 5).map((i) => s(i)), { reserved: [], favorites: [] }), 'reinvent2026', dir, noProfile, now);
    expect(result.status).toBe('checked');
    expect(Object.keys(loadWatchState('reinvent2026', dir)?.sessions ?? {})).toHaveLength(5);
  });

  it('同じ sessionId が重複して返っても、新着は1件で、件数は畳んだ後', async () => {
    let extra: Session[] = [];
    const client = fakeClient(() => [s('old'), ...extra], { reserved: [], favorites: [] });
    await runWatchOnce(client, 'reinvent2026', dir, { maxLevel: 300 }, now);
    extra = [s('new1'), s('new1')];
    const result = await runWatchOnce(client, 'reinvent2026', dir, { maxLevel: 300 }, now);
    expect(result.events.map((e) => e.kind)).toEqual(['newMatching']);
    expect(result.sessionCount).toBe(2);
  });

  it('空席の値が一時的に欠けても、available → 欠落 → available で seatOpened を出さない', async () => {
    let seat: Session['seatAvailability'] = 'available';
    const client = fakeClient(() => [s('1', { seatAvailability: seat })], { reserved: [], favorites: ['1'] });
    await runWatchOnce(client, 'reinvent2026', dir, noProfile, now);
    seat = undefined;
    const second = await runWatchOnce(client, 'reinvent2026', dir, noProfile, now);
    expect(loadWatchState('reinvent2026', dir)?.sessions['1']?.seat).toBe('available');
    seat = 'available';
    const third = await runWatchOnce(client, 'reinvent2026', dir, noProfile, now);
    expect([...second.events, ...third.events].map((e) => e.kind)).toEqual([]);
  });
});

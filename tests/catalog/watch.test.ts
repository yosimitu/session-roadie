import { describe, it, expect } from 'vitest';
import { buildWatchState, isSeatOpen, detectWatchEvents, type WatchContext } from '../../src/catalog/watch.js';
import type { Session } from '../../src/api/types.js';

export function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return {
    title: 'Test Session',
    abbreviation: 'TST101',
    venue: 'Venetian',
    room: 'Lando 4201',
    sessionTime: { date: '2026-12-02', time: '10:00', length: '60', timezone: 'America/Los_Angeles' },
    ...overrides,
  };
}

describe('isSeatOpen', () => {
  it('available / limited / veryLimited / walkUp は空席表示、unavailable と不明は空席ではない', () => {
    expect(isSeatOpen('available')).toBe(true);
    expect(isSeatOpen('limited')).toBe(true);
    expect(isSeatOpen('veryLimited')).toBe(true);
    expect(isSeatOpen('walkUp')).toBe(true);
    expect(isSeatOpen('unavailable')).toBe(false);
    expect(isSeatOpen(undefined)).toBe(false);
    expect(isSeatOpen(null)).toBe(false);
  });
});

describe('buildWatchState: previous', () => {
  it('available → 欠落 → available の確認で、seatOpened が出ない', () => {
    const c = ctx({ favoriteIds: new Set(['s1']) });
    const t1 = buildWatchState([session({ sessionId: 's1', seatAvailability: 'available' })], at);
    const t2 = buildWatchState([session({ sessionId: 's1' })], at, t1);
    expect(t2.sessions.s1?.seat).toBe('available');
    const events = detectWatchEvents(t2, [session({ sessionId: 's1', seatAvailability: 'available' })], c);
    expect(events).toEqual([]);
  });
});

describe('buildWatchState', () => {
  it('セッションごとに、空席・会場・日時・タイトルを記録する', () => {
    const state = buildWatchState(
      [session({ sessionId: 's1', seatAvailability: 'limited' })],
      new Date('2026-10-11T12:00:00Z'),
    );
    expect(state.observedAt).toBe('2026-10-11T12:00:00.000Z');
    expect(state.sessions.s1).toEqual({
      title: 'Test Session', abbreviation: 'TST101', seat: 'limited',
      venue: 'Venetian', room: 'Lando 4201', date: '2026-12-02', time: '10:00', length: '60',
    });
  });
});


const at = new Date('2026-10-11T12:00:00Z');

function ctx(overrides: Partial<WatchContext> = {}): WatchContext {
  return { reservedIds: new Set(), favoriteIds: new Set(), filterNew: () => [], ...overrides };
}

describe('detectWatchEvents: seatOpened', () => {
  it('お気に入りの未予約が満席から空席表示に変わったら seatOpened', () => {
    const before = [session({ sessionId: 's1', seatAvailability: 'unavailable' })];
    const after = [session({ sessionId: 's1', seatAvailability: 'limited' })];
    const events = detectWatchEvents(buildWatchState(before, at), after, ctx({ favoriteIds: new Set(['s1']) }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'seatOpened', session: { sessionId: 's1', seat: 'limited' } });
  });

  it('前回の空席が不明（seatAvailability なし）でも、空席表示になれば seatOpened', () => {
    const before = [session({ sessionId: 's1' })];
    const after = [session({ sessionId: 's1', seatAvailability: 'available' })];
    const events = detectWatchEvents(buildWatchState(before, at), after, ctx({ favoriteIds: new Set(['s1']) }));
    expect(events.map((e) => e.kind)).toEqual(['seatOpened']);
  });

  it('最初から空席表示のもの、空席から満席に変わったものは対象外', () => {
    const before = [session({ sessionId: 's1', seatAvailability: 'limited' }), session({ sessionId: 's2', seatAvailability: 'available' })];
    const after = [session({ sessionId: 's1', seatAvailability: 'limited' }), session({ sessionId: 's2', seatAvailability: 'unavailable' })];
    const events = detectWatchEvents(buildWatchState(before, at), after, ctx({ favoriteIds: new Set(['s1', 's2']) }));
    expect(events).toEqual([]);
  });

  it('予約済み・お気に入りでないものは対象外', () => {
    const before = [session({ sessionId: 's1', seatAvailability: 'unavailable' }), session({ sessionId: 's2', seatAvailability: 'unavailable' })];
    const after = [session({ sessionId: 's1', seatAvailability: 'limited' }), session({ sessionId: 's2', seatAvailability: 'limited' })];
    const events = detectWatchEvents(
      buildWatchState(before, at), after,
      ctx({ favoriteIds: new Set(['s1']), reservedIds: new Set(['s1']) }),
    );
    expect(events).toEqual([]);
  });

  it('前回の状態に無い（新着の）お気に入りは seatOpened にしない', () => {
    const after = [session({ sessionId: 's1', seatAvailability: 'limited' })];
    const events = detectWatchEvents(buildWatchState([], at), after, ctx({ favoriteIds: new Set(['s1']) }));
    expect(events).toEqual([]);
  });
});

describe('detectWatchEvents: altSeatOpened', () => {
  const full = session({ sessionId: 'a', abbreviation: 'SEC401', seatAvailability: 'unavailable' });

  it('満席のお気に入りの再演（-R）に空席表示が出たら altSeatOpened', () => {
    const repeatBefore = session({ sessionId: 'b', abbreviation: 'SEC401-R', seatAvailability: 'unavailable' });
    const repeatAfter = session({ sessionId: 'b', abbreviation: 'SEC401-R', seatAvailability: 'limited' });
    const events = detectWatchEvents(
      buildWatchState([full, repeatBefore], at), [full, repeatAfter],
      ctx({ favoriteIds: new Set(['a']) }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'altSeatOpened',
      session: { sessionId: 'b', seat: 'limited' },
      forSession: { sessionId: 'a' },
    });
  });

  it('お気に入り自身が空席表示なら、再演は知らせない', () => {
    const favOpen = session({ sessionId: 'a', abbreviation: 'SEC401', seatAvailability: 'limited' });
    const repeatBefore = session({ sessionId: 'b', abbreviation: 'SEC401-R', seatAvailability: 'unavailable' });
    const repeatAfter = session({ sessionId: 'b', abbreviation: 'SEC401-R', seatAvailability: 'limited' });
    const events = detectWatchEvents(
      buildWatchState([favOpen, repeatBefore], at), [favOpen, repeatAfter],
      ctx({ favoriteIds: new Set(['a']) }),
    );
    expect(events).toEqual([]);
  });

  it('再演が予約済み・お気に入りなら対象外（お気に入りは seatOpened で知らせる）', () => {
    const repeatBefore = session({ sessionId: 'b', abbreviation: 'SEC401-R', seatAvailability: 'unavailable' });
    const repeatAfter = session({ sessionId: 'b', abbreviation: 'SEC401-R', seatAvailability: 'limited' });
    const events = detectWatchEvents(
      buildWatchState([full, repeatBefore], at), [full, repeatAfter],
      ctx({ favoriteIds: new Set(['a', 'b']) }),
    );
    expect(events.map((e) => e.kind)).toEqual(['seatOpened']);
  });

  it('同じ再演が複数の満席お気に入りの代替になっても、1回だけ知らせる', () => {
    const full2 = session({ sessionId: 'c', abbreviation: 'SEC401-R1', seatAvailability: 'unavailable' });
    const repeatBefore = session({ sessionId: 'b', abbreviation: 'SEC401-R2', seatAvailability: 'unavailable' });
    const repeatAfter = session({ sessionId: 'b', abbreviation: 'SEC401-R2', seatAvailability: 'available' });
    const events = detectWatchEvents(
      buildWatchState([full, full2, repeatBefore], at), [full, full2, repeatAfter],
      ctx({ favoriteIds: new Set(['a', 'c']) }),
    );
    expect(events.filter((e) => e.kind === 'altSeatOpened')).toHaveLength(1);
  });
});

describe('detectWatchEvents: newMatching', () => {
  it('前回に無かったセッションのうち、filterNew を通ったものだけを知らせる', () => {
    const old = session({ sessionId: 'old' });
    const matching = session({ sessionId: 'new1', title: 'Security deep dive' });
    const other = session({ sessionId: 'new2', title: 'Other' });
    const events = detectWatchEvents(
      buildWatchState([old], at), [old, matching, other],
      ctx({ filterNew: (added) => added.filter((s) => s.sessionId === 'new1') }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'newMatching', session: { sessionId: 'new1', title: 'Security deep dive' } });
  });

  it('filterNew には、新着だけが渡される', () => {
    const old = session({ sessionId: 'old' });
    const added = session({ sessionId: 'new1' });
    let received: string[] = [];
    detectWatchEvents(buildWatchState([old], at), [old, added], ctx({
      filterNew: (list) => { received = list.map((s) => s.sessionId); return []; },
    }));
    expect(received).toEqual(['new1']);
  });
});

describe('detectWatchEvents: changedMine / removedMine', () => {
  it('予約済みの会場が変わったら changedMine（venue）', () => {
    const before = [session({ sessionId: 's1', venue: 'Venetian' })];
    const after = [session({ sessionId: 's1', venue: 'Wynn' })];
    const events = detectWatchEvents(buildWatchState(before, at), after, ctx({ reservedIds: new Set(['s1']) }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'changedMine', role: 'reserved', changedFields: ['venue'], session: { sessionId: 's1', venue: 'Wynn' } });
  });

  it('お気に入りの時間が変わったら changedMine（sessionTime）', () => {
    const before = [session({ sessionId: 's1' })];
    const after = [session({ sessionId: 's1', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } })];
    const events = detectWatchEvents(buildWatchState(before, at), after, ctx({ favoriteIds: new Set(['s1']) }));
    expect(events[0]).toMatchObject({ kind: 'changedMine', role: 'favorite', changedFields: ['sessionTime'] });
  });

  it('予約でもお気に入りでもないセッションの変更は知らせない', () => {
    const before = [session({ sessionId: 's1', venue: 'Venetian' })];
    const after = [session({ sessionId: 's1', venue: 'Wynn' })];
    expect(detectWatchEvents(buildWatchState(before, at), after, ctx())).toEqual([]);
  });

  it('カタログから消えた予約は removedMine（前回のタイトルを使う）', () => {
    const before = [session({ sessionId: 's1', title: 'Gone Session' })];
    const events = detectWatchEvents(buildWatchState(before, at), [], ctx({ reservedIds: new Set(['s1']) }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'removedMine', role: 'reserved', session: { sessionId: 's1', title: 'Gone Session' } });
  });

  it('予約かつお気に入りなら、予約として知らせる', () => {
    const before = [session({ sessionId: 's1', venue: 'Venetian' })];
    const after = [session({ sessionId: 's1', venue: 'Wynn' })];
    const events = detectWatchEvents(buildWatchState(before, at), after, ctx({ reservedIds: new Set(['s1']), favoriteIds: new Set(['s1']) }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ role: 'reserved' });
  });
});

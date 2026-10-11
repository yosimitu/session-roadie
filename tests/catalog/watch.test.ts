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

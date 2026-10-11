import { describe, it, expect } from 'vitest';
import { buildWatchState, isSeatOpen } from '../../src/catalog/watch.js';
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

import { describe, it, expect } from 'vitest';
import type { SeatAvailability, Session } from '../../src/api/types.js';
import type { SeatObservation } from '../../src/catalog/seatHistory.js';
import { forecastSeats } from '../../src/planning/seatForecast.js';

const s = (id: string, seat: SeatAvailability, overrides: Partial<Session> = {}): Session => ({
  sessionId: id, title: `T-${id}`, seatAvailability: seat, sessionTime: { date: '2026-12-02', time: '09:00', length: '60' }, ...overrides,
});
const obs = (date: string, seats: Record<string, SeatAvailability>): SeatObservation => ({ date, seats });

describe('forecastSeats', () => {
  it('履歴が2日分に満たないときは予報を出さず、理由を注記する', () => {
    const r = forecastSeats({ history: [obs('2026-10-07', { a: 'limited' })], sessions: [s('a', 'limited')] });
    expect(r.urgent).toEqual([]);
    expect(r.notes.join()).toContain('2日分に満たない');
  });

  it('段階が進んでいるものを、満席までの日数つきで urgent に入れる', () => {
    // 6日で available(0) → veryLimited(2)。速さ 1/3段階/日、残り1段階 → 3日で満席
    const r = forecastSeats({
      history: [obs('2026-10-07', { a: 'available' }), obs('2026-10-13', { a: 'veryLimited' })],
      sessions: [s('a', 'veryLimited')],
    });
    expect(r.urgent).toHaveLength(1);
    expect(r.urgent[0]).toMatchObject({ sessionId: 'a', trend: 'filling', daysToFull: 3, confidence: 'low' });
    expect(r.urgent[0].firstSeen).toEqual({ date: '2026-10-07', seatAvailability: 'available' });
  });

  it('満席までが horizon より遠いものは urgent に入れない', () => {
    // 6日で1段階 → 残り2段階で12日。horizon 7日なら入らない
    const r = forecastSeats({
      history: [obs('2026-10-07', { a: 'available' }), obs('2026-10-13', { a: 'limited' })],
      sessions: [s('a', 'limited')], horizonDays: 7,
    });
    expect(r.urgent).toEqual([]);
  });

  it('お気に入りを先に、次に満席が近い順に並べる', () => {
    const history = [
      obs('2026-10-07', { fast: 'available', slow: 'available', fav: 'available' }),
      obs('2026-10-13', { fast: 'veryLimited', slow: 'limited', fav: 'limited' }),
    ];
    const r = forecastSeats({
      history, favoriteIds: ['fav'],
      sessions: [s('fast', 'veryLimited'), s('slow', 'limited'), s('fav', 'limited')],
    });
    expect(r.urgent.map((i) => i.sessionId)).toEqual(['fav', 'fast', 'slow']);
  });

  it('満席・予約済みは対象外', () => {
    const history = [obs('2026-10-07', { full: 'limited', mine: 'available' }), obs('2026-10-13', { full: 'unavailable', mine: 'veryLimited' })];
    const r = forecastSeats({ history, reservedIds: ['mine'], sessions: [s('full', 'unavailable'), s('mine', 'veryLimited')] });
    expect(r.urgent).toEqual([]);
  });

  it('動いていなくて関心のあるトピックのものを hidden に、空席が増えたものを freeing に入れる', () => {
    const history = [
      obs('2026-10-07', { calm: 'available', calmOther: 'available', opening: 'veryLimited' }),
      obs('2026-10-13', { calm: 'available', calmOther: 'available', opening: 'limited' }),
    ];
    const r = forecastSeats({
      history, profile: { interestTopics: ['Security & Identity'] },
      sessions: [
        s('calm', 'available', { topics: ['Security & Identity'] }),
        s('calmOther', 'available', { topics: ['Other'] }),
        s('opening', 'limited'),
      ],
    });
    expect(r.hidden.map((i) => i.sessionId)).toEqual(['calm']);
    expect(r.freeing.map((i) => i.sessionId)).toEqual(['opening']);
  });

  it('プロフィールの参加日の外のセッションは、お気に入りでなければ除く', () => {
    const history = [obs('2026-10-07', { out: 'available', favOut: 'available' }), obs('2026-10-13', { out: 'veryLimited', favOut: 'veryLimited' })];
    const sessions = [
      s('out', 'veryLimited', { sessionTime: { date: '2026-12-04', time: '09:00', length: '60' } }),
      s('favOut', 'veryLimited', { sessionTime: { date: '2026-12-04', time: '10:00', length: '60' } }),
      s('in', 'veryLimited'),
    ];
    const r = forecastSeats({ history, sessions, favoriteIds: ['favOut'], profile: { attendance: { firstDay: '2026-12-01', lastDay: '2026-12-03' } } });
    expect(r.urgent.map((i) => i.sessionId)).toEqual(['favOut']);
  });

  it('観測が増えると信頼度が上がる', () => {
    const history = ['2026-10-07', '2026-10-09', '2026-10-11', '2026-10-13', '2026-10-15'].map((d, i) =>
      obs(d, { a: (['available', 'available', 'limited', 'limited', 'veryLimited'] as SeatAvailability[])[i] }));
    const r = forecastSeats({ history, sessions: [s('a', 'veryLimited')] });
    expect(r.urgent[0].confidence).toBe('high');
  });
});

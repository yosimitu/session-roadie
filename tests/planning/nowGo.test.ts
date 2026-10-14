import { describe, it, expect } from 'vitest';
import type { Session } from '../../src/api/types.js';
import { findSessionsNow, inferCurrentVenue } from '../../src/planning/nowGo.js';

// 会場現地 2026-12-02 の時刻から、実際の時刻（UTC）を作る（会場は UTC-8）
const at = (hhmm: string, date = '2026-12-02'): Date => new Date(`${date}T${hhmm}:00-08:00`);

function session(id: string, time: string, overrides: Partial<Session> = {}): Session {
  return {
    sessionId: id, title: `Session ${id}`, abbreviation: id.toUpperCase(),
    venue: 'Venetian', seatAvailability: 'available',
    sessionTime: { date: '2026-12-02', time, length: '60' },
    ...overrides,
  };
}

const base = { personalTimes: [], reserved: [] as Session[] };

describe('findSessionsNow', () => {
  it('いまから90分以内に始まるセッションを、開始の近い順に返す', () => {
    const sessions = [session('c', '11:30'), session('a', '10:15'), session('late', '13:00'), session('past', '09:00')];
    const result = findSessionsNow({ ...base, sessions, now: at('10:00'), currentVenue: 'Venetian' });
    expect(result.items.map((i) => i.sessionId)).toEqual(['a', 'c']);
    expect(result.items[0].startsInMinutes).toBe(15);
  });

  it('移動時間が足りない会場のセッションは除く', () => {
    // Venetian→MGM は30分。開始まで15分しかない MGM のセッションには間に合わない
    const sessions = [session('mgm', '10:15', { venue: 'MGM Grand' }), session('near', '10:15', { venue: 'Venetian' })];
    const result = findSessionsNow({ ...base, sessions, now: at('10:00'), currentVenue: 'Venetian' });
    expect(result.items.map((i) => i.sessionId)).toEqual(['near']);
  });

  it('満席（unavailable）と予約済みは除き、walkUp は注記つきで残す', () => {
    const sessions = [
      session('full', '10:30', { seatAvailability: 'unavailable' }),
      session('mine', '10:30'),
      session('walk', '11:30', { seatAvailability: 'walkUp' }), // 予約の終了直後。同じ会場で移動なし
    ];
    const reserved = [sessions[1]];
    const result = findSessionsNow({ ...base, sessions, reserved, now: at('10:00'), currentVenue: 'Venetian' });
    expect(result.items.map((i) => i.sessionId)).toEqual(['walk']);
    expect(result.items[0].notes.join()).toContain('walkUp');
  });

  it('予約と重なるセッション、次の予約への移動が間に合わないセッションは除く', () => {
    const next = session('next', '11:30', { venue: 'Wynn/Encore' });
    const sessions = [
      next,
      session('overlap', '11:00'), // 11:00-12:00 で next と重なる
      session('tight', '10:20', { sessionTime: { date: '2026-12-02', time: '10:20', length: '60' } }), // 11:20 終了。Venetian→Wynn 15分が取れない
      session('ok', '10:10', { sessionTime: { date: '2026-12-02', time: '10:10', length: '60' } }), // 11:10 終了。20分の余裕
    ];
    const result = findSessionsNow({ ...base, sessions, reserved: [next], now: at('10:00'), currentVenue: 'Venetian' });
    expect(result.items.map((i) => i.sessionId)).toEqual(['ok']);
  });

  it('お気に入りと関心のあるトピックを先に並べる', () => {
    const sessions = [
      session('plain', '10:10'),
      session('topic', '10:20', { topics: ['Security & Identity'] }),
      session('fav', '10:30'),
    ];
    const result = findSessionsNow({
      ...base, sessions, now: at('10:00'), currentVenue: 'Venetian',
      favoriteIds: ['fav'], profile: { interestTopics: ['Security & Identity'] },
    });
    expect(result.items.map((i) => i.sessionId)).toEqual(['fav', 'topic', 'plain']);
  });

  it('プロフィールのレベルとスポンサーの除外を守る', () => {
    const sessions = [
      session('l400', '10:10', { level: '400 - Expert' }),
      session('spons', '10:20', { abbreviation: 'ABC101-S' }),
      session('ok', '10:30', { level: '200 - Intermediate' }),
    ];
    const result = findSessionsNow({
      ...base, sessions, now: at('10:00'), currentVenue: 'Venetian',
      profile: { maxLevel: 300, excludeSponsored: true },
    });
    expect(result.items.map((i) => i.sessionId)).toEqual(['ok']);
  });

  it('現在の会場を省略すると、いま開催中の予約の会場を使う', () => {
    const current = session('now', '09:30', { venue: 'MGM Grand' });
    const sessions = [current, session('mgmNext', '10:45', { venue: 'MGM Grand' }), session('veneNext', '10:20')];
    const result = findSessionsNow({ ...base, sessions, reserved: [current], now: at('10:00') });
    expect(result.currentVenue).toBe('MGM Grand');
    // Venetian の 10:20 は MGM から30分かかるので間に合わない
    expect(result.items.map((i) => i.sessionId)).toEqual(['mgmNext']);
  });

  it('現在の会場が分からないときは、その旨を注記する', () => {
    const result = findSessionsNow({ ...base, sessions: [session('a', '10:10')], now: at('10:00') });
    expect(result.currentVenue).toBeUndefined();
    expect(result.notes.join()).toContain('現在の会場が分からない');
  });

  it('limit で件数を絞る', () => {
    const sessions = ['a', 'b', 'c'].map((id, i) => session(id, `10:${10 + i * 5}`));
    const result = findSessionsNow({ ...base, sessions, now: at('10:00'), currentVenue: 'Venetian', limit: 2 });
    expect(result.items).toHaveLength(2);
  });
});

describe('inferCurrentVenue', () => {
  it('直近3時間以内に終わった予約の会場を使い、それより前なら使わない', () => {
    const ended = session('e', '08:00', { venue: 'Wynn/Encore' });
    expect(inferCurrentVenue([ended], at('10:00'))).toBe('Wynn/Encore');
    expect(inferCurrentVenue([ended], at('12:30'))).toBeUndefined();
  });
});

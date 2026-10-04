import { describe, it, expect } from 'vitest';
import { optimizeDefaultsFromProfile, datesWithinAttendance } from '../../src/planning/preferences.js';

const EVENT_DATES = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];

describe('optimizeDefaultsFromProfile', () => {
  it('プロフィールが無ければ既定値なし', () => {
    expect(optimizeDefaultsFromProfile(undefined)).toEqual({});
  });

  it('体力を1日の上限本数と最低空き時間に変換する（packedは制約なし）', () => {
    expect(optimizeDefaultsFromProfile({ stamina: 'relaxed' })).toEqual({ maxSessionsPerDay: 3, minGapMinutes: 30 });
    expect(optimizeDefaultsFromProfile({ stamina: 'normal' })).toEqual({ maxSessionsPerDay: 4, minGapMinutes: 15 });
    expect(optimizeDefaultsFromProfile({ stamina: 'packed' })).toEqual({});
  });

  it('目的を優先形式に変換する', () => {
    expect(optimizeDefaultsFromProfile({ purpose: 'learning' }).preferredTypes).toContain('Workshop');
    expect(optimizeDefaultsFromProfile({ purpose: 'report' }).preferredTypes).toEqual(['Breakout session']);
  });

  it('参加日をdateRangeに変換する', () => {
    expect(optimizeDefaultsFromProfile({ attendance: { firstDay: '2026-12-01' } }).dateRange).toEqual({ firstDay: '2026-12-01', lastDay: undefined });
  });
});

describe('datesWithinAttendance', () => {
  it('参加日の範囲に入る会期の日付だけを返す', () => {
    expect(datesWithinAttendance(EVENT_DATES, { attendance: { firstDay: '2026-12-01', lastDay: '2026-12-03' } }))
      .toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    expect(datesWithinAttendance(EVENT_DATES, { attendance: { lastDay: '2026-12-01' } })).toEqual(['2026-11-30', '2026-12-01']);
  });

  it('参加日が未設定ならundefined（絞り込まない）', () => {
    expect(datesWithinAttendance(EVENT_DATES, { stamina: 'normal' })).toBeUndefined();
    expect(datesWithinAttendance(EVENT_DATES, undefined)).toBeUndefined();
  });
});

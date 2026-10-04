import { describe, it, expect } from 'vitest';
import { optimizeSchedule } from '../../src/planning/optimize.js';
import type { PersonalTime, Session } from '../../src/api/types.js';

function session(sessionId: string, abbreviation: string | undefined, date: string, time: string, length = '60', venue?: string): Session {
  return { sessionId, abbreviation, title: `T-${sessionId}`, venue, sessionTime: { date, time, length } };
}

// 12/2 08:30-10:00 PST = 16:30-18:00 UTC
const keynote: PersonalTime = { personalTimeId: 'k', title: 'Keynote', description: '', startDateTime: '2026-12-02T16:30:00', endDateTime: '2026-12-02T18:00:00' };

describe('optimizeSchedule', () => {
  it('重ならなければ指定どおりの回をすべて選ぶ（差し替えなし）', () => {
    const a = session('a', 'AIM101', '2026-12-01', '09:00');
    const b = session('b', 'AIM102', '2026-12-01', '11:00');
    const result = optimizeSchedule(['a', 'b'], [a, b], []);

    expect(result.reserve).toEqual(['a', 'b']);
    expect(result.selected.every((s) => !s.substitutedFor)).toBe(true);
    expect(result.dropped).toEqual([]);
    expect(result.optimal).toBe(true);
  });

  it('重なる場合は再演に差し替えて両方を入れる', () => {
    const a = session('a', 'AIM101', '2026-12-01', '09:00');
    const b = session('b', 'DAT410-R', '2026-12-01', '09:30');
    const bRepeat = session('b1', 'DAT410-R1', '2026-12-03', '13:00');
    const result = optimizeSchedule(['a', 'b'], [a, b, bRepeat], []);

    expect(result.reserve.sort()).toEqual(['a', 'b1']);
    expect(result.selected.find((s) => s.sessionId === 'b1')?.substitutedFor).toEqual(['b']);
  });

  it('個人予定（基調講演）と重なる回は選ばず、再演が無ければ理由つきで落とす', () => {
    const w = session('w', 'DAT429', '2026-12-02', '08:00', '120');
    const result = optimizeSchedule(['w'], [w], [keynote]);

    expect(result.reserve).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].options[0].blockedBy).toEqual([{ kind: 'personalTime', personalTimeId: 'k', title: 'Keynote' }]);
  });

  it('本数が最大になる組み合わせを選ぶ（貪欲に先頭を取ると1本しか入らないケース）', () => {
    const long = session('long', 'AIM200', '2026-12-01', '09:00', '180');
    const x = session('x', 'AIM201', '2026-12-01', '09:00');
    const y = session('y', 'AIM202', '2026-12-01', '10:30');
    const result = optimizeSchedule(['long', 'x', 'y'], [long, x, y], []);

    expect(result.reserve.sort()).toEqual(['x', 'y']);
    expect(result.dropped.map((d) => d.requestedSessionIds)).toEqual([['long']]);
  });

  it('同じ元番号の回を複数指定しても1グループとして扱い、1回だけ選ぶ', () => {
    const r = session('r', 'OPN401-R', '2026-12-01', '11:30');
    const r1 = session('r1', 'OPN401-R1', '2026-12-02', '09:00');
    const result = optimizeSchedule(['r', 'r1'], [r, r1], []);

    expect(result.reserve).toEqual(['r']);
    expect(result.selected[0].substitutedFor).toBeUndefined();
  });

  it('別会場への移動が間に合わない連続セッションは両立させない', () => {
    const a = session('a', 'AIM101', '2026-12-01', '11:30', '60', 'Caesars');
    const b = session('b', 'AIM102', '2026-12-01', '12:30', '60', 'MGM');
    const withTravel = optimizeSchedule(['a', 'b'], [a, b], []);
    expect(withTravel.reserve).toHaveLength(1);
    expect(withTravel.dropped[0].options[0].blockedBy[0]).toMatchObject({ kind: 'session', requiredTravelMinutes: 20 });

    const withoutTravel = optimizeSchedule(['a', 'b'], [a, b], [], { considerTravelTime: false });
    expect(withoutTravel.reserve).toHaveLength(2);
  });

  it('同じ会場なら連続でも両立する', () => {
    const a = session('a', 'AIM101', '2026-12-01', '11:30', '60', 'MGM');
    const b = session('b', 'AIM102', '2026-12-01', '12:30', '60', 'MGM');
    expect(optimizeSchedule(['a', 'b'], [a, b], []).reserve).toHaveLength(2);
  });

  it('カタログに無いIDと時刻情報の無いセッションを分けて返す', () => {
    const noTime: Session = { sessionId: 'nt', abbreviation: 'AIM999', title: 'On demand' };
    const result = optimizeSchedule(['missing', 'nt'], [noTime], []);
    expect(result.unknownSessionIds).toEqual(['missing']);
    expect(result.withoutTime).toEqual(['nt']);
  });

  it('1日の上限本数を超えないように選び、超えた分は dailyLimit を理由に落とす', () => {
    const sessions = ['09:00', '11:00', '13:00', '15:00'].map((t, i) => session(`s${i}`, `AIM10${i}`, '2026-12-01', t));
    const result = optimizeSchedule(sessions.map((s) => s.sessionId), sessions, [], { maxSessionsPerDay: 3 });

    expect(result.reserve).toHaveLength(3);
    expect(result.dropped[0].options[0].blockedBy).toContainEqual({ kind: 'dailyLimit', date: '2026-12-01', limit: 3 });
  });

  it('上限は日ごとに数える（別の日なら入る）', () => {
    const d1 = session('a', 'AIM101', '2026-12-01', '09:00');
    const d1b = session('b', 'AIM102', '2026-12-01', '11:00');
    const d2 = session('c', 'AIM103', '2026-12-02', '09:00');
    expect(optimizeSchedule(['a', 'b', 'c'], [d1, d1b, d2], [], { maxSessionsPerDay: 1 }).reserve).toHaveLength(2);
  });

  it('最低空き時間に満たない連続セッションは両立させない（同じ会場でも）', () => {
    const a = session('a', 'AIM101', '2026-12-01', '09:00', '60', 'MGM');
    const b = session('b', 'AIM102', '2026-12-01', '10:15', '60', 'MGM');
    const result = optimizeSchedule(['a', 'b'], [a, b], [], { minGapMinutes: 30 });
    expect(result.reserve).toHaveLength(1);
    expect(result.dropped[0].options[0].blockedBy[0]).toMatchObject({ kind: 'session', minGapMinutes: 30 });

    expect(optimizeSchedule(['a', 'b'], [a, b], [], { minGapMinutes: 15 }).reserve).toHaveLength(2);
  });

  it('本数が同じなら優先形式を多く含む組み合わせを選ぶ', () => {
    const breakout = { ...session('br', 'AIM101', '2026-12-01', '09:00'), type: 'Breakout session' };
    const workshop = { ...session('ws', 'AIM102', '2026-12-01', '09:30'), type: 'Workshop' };
    expect(optimizeSchedule(['br', 'ws'], [breakout, workshop], [], { preferredTypes: ['Workshop'] }).reserve).toEqual(['ws']);
    expect(optimizeSchedule(['br', 'ws'], [breakout, workshop], [], { preferredTypes: ['Breakout session'] }).reserve).toEqual(['br']);
  });

  it('優先形式より本数を優先する', () => {
    const workshop = { ...session('ws', 'AIM100', '2026-12-01', '09:00', '180'), type: 'Workshop' };
    const b1 = { ...session('b1', 'AIM101', '2026-12-01', '09:00'), type: 'Breakout session' };
    const b2 = { ...session('b2', 'AIM102', '2026-12-01', '11:00'), type: 'Breakout session' };
    expect(optimizeSchedule(['ws', 'b1', 'b2'], [workshop, b1, b2], [], { preferredTypes: ['Workshop'] }).reserve.sort()).toEqual(['b1', 'b2']);
  });

  it('参加日の範囲外の回は選ばず、範囲内の再演があればそちらに差し替える', () => {
    const early = session('r', 'DAT410-R', '2026-11-30', '16:00');
    const later = session('r1', 'DAT410-R1', '2026-12-02', '13:30');
    const result = optimizeSchedule(['r'], [early, later], [], { dateRange: { firstDay: '2026-12-01' } });
    expect(result.reserve).toEqual(['r1']);

    const none = optimizeSchedule(['r'], [early, later], [], { dateRange: { lastDay: '2026-11-29' } });
    expect(none.dropped[0].options.map((o) => o.blockedBy[0])).toEqual([
      { kind: 'outsideAttendance', date: '2026-11-30' },
      { kind: 'outsideAttendance', date: '2026-12-02' },
    ]);
  });

  it('探索ノード上限に達したら optimal: false を返す', () => {
    const sessions = Array.from({ length: 6 }, (_, i) => session(`s${i}`, `AIM10${i}`, '2026-12-01', '09:00'));
    const result = optimizeSchedule(sessions.map((s) => s.sessionId), sessions, [], { maxNodes: 3 });
    expect(result.optimal).toBe(false);
  });
});

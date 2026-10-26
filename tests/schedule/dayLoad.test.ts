import { describe, it, expect } from 'vitest';
import { computeDayLoads } from '../../src/schedule/dayLoad.js';
import type { Session } from '../../src/api/types.js';

function session(sessionId: string, date: string, time: string, length: string, venue: string): Session {
  return { sessionId, title: sessionId, venue, sessionTime: { date, time, length } };
}

describe('computeDayLoads', () => {
  it('日ごとに、セッション数・合計時間・会場移動の回数と移動時間（概算）を集計する', () => {
    const loads = computeDayLoads([
      session('a', '2026-12-02', '10:00', '60', 'Venetian'),
      session('b', '2026-12-02', '11:30', '60', 'Wynn/Encore'), // Venetian → Wynn: 15分
      session('c', '2026-12-02', '13:00', '30', 'Wynn/Encore'), // 同じ会場: 移動なし
      session('d', '2026-12-03', '09:00', '45', 'MGM Grand'),
    ]);
    expect(loads.get('2026-12-02')).toEqual({ date: '2026-12-02', sessions: 3, sessionMinutes: 150, moves: 1, travelMinutes: 15 });
    expect(loads.get('2026-12-03')).toEqual({ date: '2026-12-03', sessions: 1, sessionMinutes: 45, moves: 0, travelMinutes: 0 });
  });

  it('日をまたぐ組は移動に数えず、予約順に関係なく時刻順で隣り合う組を見る', () => {
    const loads = computeDayLoads([
      session('late', '2026-12-02', '15:00', '60', 'MGM Grand'),
      session('early', '2026-12-02', '10:00', '60', 'Venetian'),
      session('next', '2026-12-03', '09:00', '60', 'Wynn/Encore'),
    ]);
    // 時刻順は early(Venetian) → late(MGM)。MGM↔Venetian は30分
    expect(loads.get('2026-12-02')).toMatchObject({ moves: 1, travelMinutes: 30 });
    expect(loads.get('2026-12-03')).toMatchObject({ moves: 0, travelMinutes: 0 });
  });

  it('日時が読めないセッションは数えず、予約が無ければ空', () => {
    expect(computeDayLoads([]).size).toBe(0);
    const loads = computeDayLoads([{ sessionId: 'x', title: 'x', venue: 'Venetian' }]);
    expect(loads.size).toBe(0);
  });
});

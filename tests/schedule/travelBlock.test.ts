import { describe, it, expect } from 'vitest';
import { computeTravelBlock } from '../../src/schedule/travelBlock.js';
import type { Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('computeTravelBlock', () => {
  it('移動が間に合う場合はPersonalTimeInputを生成する', () => {
    const a = session({
      sessionId: 'a', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    });
    const b = session({
      sessionId: 'b', venue: 'Wynn',
      sessionTime: { date: '2026-12-02', time: '11:30', length: '60' },
    });
    const result = computeTravelBlock(a, b);
    expect(result?.sufficient).toBe(true);
    expect(result?.requiredMinutes).toBe(15);
    expect(result?.availableMinutes).toBe(30);
    // 10:00 PST開始+60分 = 11:00 PST終了（現地時刻のまま書く）
    expect(result?.personalTime?.startDateTime).toBe('2026-12-02T11:00:00');
    // 11:30 PST開始
    expect(result?.personalTime?.endDateTime).toBe('2026-12-02T11:30:00');
    expect(result?.personalTime?.title).not.toContain('[');
  });

  it('移動が間に合わない場合はPersonalTimeInputを生成しない', () => {
    const a = session({
      sessionId: 'a', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    });
    const b = session({
      sessionId: 'b', venue: 'MGM',
      sessionTime: { date: '2026-12-02', time: '11:10', length: '60' },
    });
    const result = computeTravelBlock(a, b);
    expect(result?.sufficient).toBe(false);
    expect(result?.personalTime).toBeUndefined();
  });

  it('同一会場なら移動時間0分で、空き時間に関わらずブロックを生成しない', () => {
    const a = session({
      sessionId: 'a', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    });
    const b = session({
      sessionId: 'b', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '11:00', length: '60' },
    });
    const result = computeTravelBlock(a, b);
    expect(result?.sufficient).toBe(true);
    expect(result?.requiredMinutes).toBe(0);
    expect(result?.personalTime).toBeUndefined();
  });

  it('会場や時刻が欠けているセッションはundefinedを返す', () => {
    const a = session({ sessionId: 'a' });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } });
    expect(computeTravelBlock(a, b)).toBeUndefined();
  });
});

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
    // 必要な15分だけを前のセッションの終了直後に置く（次の開始 11:30 までは埋めない）
    expect(result?.personalTime?.endDateTime).toBe('2026-12-02T11:15:00');
    expect(result?.personalTime?.title).not.toContain('[');
  });

  it('空き時間が長くても、ブロックは必要な移動時間だけにする', () => {
    const a = session({
      sessionId: 'a', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    });
    const b = session({
      sessionId: 'b', venue: 'Wynn',
      sessionTime: { date: '2026-12-02', time: '12:00', length: '60' },
    });
    const result = computeTravelBlock(a, b);
    expect(result?.availableMinutes).toBe(60);
    expect(result?.personalTime?.startDateTime).toBe('2026-12-02T11:00:00');
    expect(result?.personalTime?.endDateTime).toBe('2026-12-02T11:15:00');
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

  it('同一会場なら移動時間0分で、ブロックを生成しない（開始の10分前に着ける間隔があれば足りる）', () => {
    const a = session({
      sessionId: 'a', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    });
    const b = session({
      sessionId: 'b', venue: 'Venetian',
      sessionTime: { date: '2026-12-02', time: '11:10', length: '60' },
    });
    const result = computeTravelBlock(a, b);
    expect(result?.sufficient).toBe(true);
    expect(result?.requiredMinutes).toBe(0);
    expect(result?.neededMinutes).toBe(10);
    expect(result?.personalTime).toBeUndefined();
  });

  it('終了と同時に始まる連続セッションは、同一会場でも不足とする（席は開始の10分前までに着かないと譲られる）', () => {
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } });
    const result = computeTravelBlock(a, b);
    expect(result).toMatchObject({ sufficient: false, requiredMinutes: 0, arrivalBufferMinutes: 10, neededMinutes: 10, availableMinutes: 0 });
  });

  it('移動時間はちょうどでも、到着の余裕が取れなければ不足とする（Venetian→Wynn 15分に対して空き20分）', () => {
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:20', length: '60' } });
    const result = computeTravelBlock(a, b);
    expect(result).toMatchObject({ sufficient: false, requiredMinutes: 15, neededMinutes: 25, availableMinutes: 20 });
    expect(result?.personalTime).toBeUndefined();
  });

  it('会場や時刻が欠けているセッションはundefinedを返す', () => {
    const a = session({ sessionId: 'a' });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } });
    expect(computeTravelBlock(a, b)).toBeUndefined();
  });
});

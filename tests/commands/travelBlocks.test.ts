import { describe, it, expect } from 'vitest';
import { planTravelBlocks } from '../../src/commands/travelBlocks.js';
import type { Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('planTravelBlocks', () => {
  it('時刻順に並べ、隣接するセッション間の移動時間を計算する', () => {
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:30', length: '60' } });
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });

    // 入力順はb, aだが、時刻でソートされてa→bの順でブロックが計算される
    const blocks = planTravelBlocks([b, a]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].from.sessionId).toBe('a');
    expect(blocks[0].to.sessionId).toBe('b');
    expect(blocks[0].result.sufficient).toBe(true);
  });

  it('日付が異なるセッション同士はペアにしない', () => {
    const day1 = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '16:00', length: '60' } });
    const day2 = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-03', time: '09:00', length: '60' } });

    expect(planTravelBlocks([day1, day2])).toEqual([]);
  });

  it('時刻情報が無いセッションは無視する', () => {
    const noTime = session({ sessionId: 'a', venue: 'Venetian' });
    const withTime = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } });

    expect(planTravelBlocks([noTime, withTime])).toEqual([]);
  });

  it('3件以上なら隣接ペアすべてについて計算する', () => {
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:30', length: '60' } });
    const c = session({ sessionId: 'c', venue: 'Caesars', sessionTime: { date: '2026-12-02', time: '13:00', length: '60' } });

    const blocks = planTravelBlocks([a, b, c]);

    expect(blocks.map((blk) => `${blk.from.sessionId}->${blk.to.sessionId}`)).toEqual(['a->b', 'b->c']);
  });
});

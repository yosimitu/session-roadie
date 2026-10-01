import { describe, it, expect } from 'vitest';
import { findConflicts } from '../../src/commands/conflicts.js';
import type { Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('findConflicts', () => {
  it('同じ日時に重なる予約済みセッションをグループ化する', () => {
    const a = session({ sessionId: 'a', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', sessionTime: { date: '2026-12-02', time: '10:30', length: '60' } });
    const c = session({ sessionId: 'c', sessionTime: { date: '2026-12-02', time: '14:00', length: '60' } });

    const groups = findConflicts([a, b, c]);

    expect(groups).toHaveLength(1);
    expect(groups[0].map((s) => s.sessionId).sort()).toEqual(['a', 'b']);
  });

  it('重ならなければ空配列', () => {
    const a = session({ sessionId: 'a', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } });
    expect(findConflicts([a, b])).toEqual([]);
  });
});

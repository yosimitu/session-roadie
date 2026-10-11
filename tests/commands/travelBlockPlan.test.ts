import { describe, it, expect, vi } from 'vitest';
import { buildTravelBlockPlan, applyTravelBlocks } from '../../src/commands/travelBlocks.js';
import type { ApiClient } from '../../src/api/client.js';
import type { Schedule, Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('buildTravelBlockPlan', () => {
  it('予約済みセッションのうちスナップショットに無いものをmissingSessionIdsに入れる', () => {
    const schedule: Schedule = { reserved: ['a', 'missing'], favorites: [], personalTime: [] };
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });

    const plan = buildTravelBlockPlan(schedule, [a]);

    expect(plan.missingSessionIds).toEqual(['missing']);
  });

  it('移動が間に合わないブロックをinsufficientBlocksに入れる', () => {
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'MGM', sessionTime: { date: '2026-12-02', time: '11:10', length: '60' } });
    const schedule: Schedule = { reserved: ['a', 'b'], favorites: [], personalTime: [] };

    const plan = buildTravelBlockPlan(schedule, [a, b]);

    expect(plan.insufficientBlocks).toHaveLength(1);
    expect(plan.candidates).toEqual([]);
  });

  it('既に同じPersonalTimeが存在するブロックはcandidatesから除外する（重複作成防止）', () => {
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:30', length: '60' } });
    const schedule: Schedule = {
      reserved: ['a', 'b'], favorites: [],
      personalTime: [{
        personalTimeId: 'pt-1',
        startDateTime: '2026-12-02T11:00:00', endDateTime: '2026-12-02T11:30:00',
        title: 'Venetian → Wynn 移動', description: '15分の移動時間を確保（概算値・要検証）',
      }],
    };

    const plan = buildTravelBlockPlan(schedule, [a, b]);

    expect(plan.candidates).toEqual([]);
  });

  it('新規に確保すべきブロックをcandidatesに入れる', () => {
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:30', length: '60' } });
    const schedule: Schedule = { reserved: ['a', 'b'], favorites: [], personalTime: [] };

    const plan = buildTravelBlockPlan(schedule, [a, b]);

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].from.sessionId).toBe('a');
  });
});

describe('applyTravelBlocks', () => {
  it('candidatesの個人予定をすべてcreatePersonalTimeで作成し、件数を返す', async () => {
    const postJson = vi.fn().mockResolvedValue({ content: '' });
    const client = { postJson } as unknown as ApiClient;
    const a = session({ sessionId: 'a', venue: 'Venetian', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', venue: 'Wynn', sessionTime: { date: '2026-12-02', time: '11:30', length: '60' } });
    const schedule: Schedule = { reserved: ['a', 'b'], favorites: [], personalTime: [] };
    const plan = buildTravelBlockPlan(schedule, [a, b]);

    const count = await applyTravelBlocks(client, 'reinvent2026', plan.candidates);

    expect(count).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { buildNoteReminderPlan, applyNoteReminders } from '../../src/commands/noteReminders.js';
import type { ApiClient } from '../../src/api/client.js';
import type { Schedule, Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('buildNoteReminderPlan', () => {
  it('カタログに存在しないセッションIDのメモは無視する', () => {
    const schedule: Schedule = { reserved: [], favorites: [], personalTime: [] };
    const plan = buildNoteReminderPlan({ unknown: 'メモ' }, [], schedule);
    expect(plan).toEqual([]);
  });

  it('時刻情報が無いセッションのメモは無視する', () => {
    const s = session({ sessionId: 's1' });
    const schedule: Schedule = { reserved: [], favorites: [], personalTime: [] };
    const plan = buildNoteReminderPlan({ s1: 'メモ' }, [s], schedule);
    expect(plan).toEqual([]);
  });

  it('既に同じリマインダーが存在するものは除外する（重複防止）', () => {
    const s = session({ sessionId: 's1', title: 'SVS401', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const schedule: Schedule = {
      reserved: [], favorites: [],
      personalTime: [{
        personalTimeId: 'pt-1',
        startDateTime: '2026-12-02T17:45:00', endDateTime: '2026-12-02T18:00:00',
        title: '📝 SVS401', description: 'メモ',
      }],
    };
    const plan = buildNoteReminderPlan({ s1: 'メモ' }, [s], schedule);
    expect(plan).toEqual([]);
  });

  it('新規のリマインダーを候補として返す', () => {
    const s = session({ sessionId: 's1', title: 'SVS401', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const schedule: Schedule = { reserved: [], favorites: [], personalTime: [] };
    const plan = buildNoteReminderPlan({ s1: 'メモ' }, [s], schedule);
    expect(plan).toHaveLength(1);
    expect(plan[0].sessionId).toBe('s1');
  });
});

describe('applyNoteReminders', () => {
  it('候補をすべてcreatePersonalTimeで作成し、件数を返す', async () => {
    const postJson = vi.fn().mockResolvedValue({ content: '' });
    const client = { postJson } as unknown as ApiClient;
    const s = session({ sessionId: 's1', title: 'SVS401', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const schedule: Schedule = { reserved: [], favorites: [], personalTime: [] };
    const plan = buildNoteReminderPlan({ s1: 'メモ' }, [s], schedule);

    const count = await applyNoteReminders(client, 'reinvent2026', plan);

    expect(count).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
  });
});

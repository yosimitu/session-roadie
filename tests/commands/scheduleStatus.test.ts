import { describe, it, expect, vi } from 'vitest';
import { runScheduleStatus } from '../../src/commands/scheduleStatus.js';
import type { ApiClient } from '../../src/api/client.js';
import type { Schedule } from '../../src/api/types.js';

describe('runScheduleStatus', () => {
  it('scheduleキーでラップされたレスポンス（2026-10-01実データ確認）からScheduleを取り出す', async () => {
    const schedule: Schedule = { reserved: ['s1'], favorites: [], personalTime: [] };
    const get = vi.fn().mockResolvedValue({ schedule });
    const client = { get } as unknown as ApiClient;

    const result = await runScheduleStatus(client, 'reinvent2026');

    expect(result).toEqual(schedule);
    expect(get).toHaveBeenCalledWith('/v1/events/reinvent2026/schedule', 'GetSchedule');
  });
});

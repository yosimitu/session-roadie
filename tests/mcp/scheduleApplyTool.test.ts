import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../src/api/client.js';

vi.mock('../../src/runtimeContext.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtimeContext.js')>()),
  createClient: vi.fn(),
}));

vi.mock('../../src/schedule/backup.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/schedule/backup.js')>()),
  saveScheduleBackup: vi.fn(() => '/tmp/schedule-backup-test.json'),
}));

import { createClient } from '../../src/runtimeContext.js';
import { saveScheduleBackup } from '../../src/schedule/backup.js';
import { scheduleApplyTool } from '../../src/mcp/tools.js';

const emptySchedule = { schedule: { reserved: [], favorites: [], personalTime: [] } };

describe('scheduleApplyTool', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(saveScheduleBackup).mockClear();
  });

  it('plan・result・remainingPlanを合成して返す', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(emptySchedule)
      .mockResolvedValueOnce({ schedule: { reserved: ['s1'], favorites: [], personalTime: [] } });
    const postJson = vi.fn().mockResolvedValue({ result: { successful: ['s1'], failed: [] } });
    vi.mocked(createClient).mockResolvedValue({ get, postJson } as never);

    const out = await scheduleApplyTool(['s1'], undefined);

    expect(out.plan.toReserve).toEqual(['s1']);
    expect(out.result.reserve).toEqual({ ok: true, value: { successful: ['s1'], failed: [] } });
    expect(out).toHaveProperty('remainingPlan');
    expect(out).not.toHaveProperty('reconcileError');
    expect(saveScheduleBackup).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ backupPath: '/tmp/schedule-backup-test.json' });
  });

  it('差分が無いときはバックアップを作らない', async () => {
    const get = vi.fn().mockResolvedValue(emptySchedule);
    vi.mocked(createClient).mockResolvedValue({ get } as never);

    const out = await scheduleApplyTool(undefined, undefined);

    expect(saveScheduleBackup).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty('backupPath');
  });

  it('バックアップを保存できなければ、書き込みに進まず例外にする', async () => {
    const get = vi.fn().mockResolvedValue(emptySchedule);
    const postJson = vi.fn();
    vi.mocked(createClient).mockResolvedValue({ get, postJson } as never);
    vi.mocked(saveScheduleBackup).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    await expect(scheduleApplyTool(['s1'], undefined)).rejects.toThrow('disk full');
    expect(postJson).not.toHaveBeenCalled();
  });

  it('実行後の再照合が失敗しても、実行結果を失わずreconcileErrorを返す', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(emptySchedule)
      .mockRejectedValueOnce(new ApiError(401, undefined, undefined, 'GetSchedule'));
    const postJson = vi.fn().mockRejectedValue(new ApiError(409, { message: 'not open' }, undefined, 'ReserveSessions'));
    vi.mocked(createClient).mockResolvedValue({ get, postJson } as never);

    const out = await scheduleApplyTool(['s1'], undefined);

    expect(out.result.reserve).toMatchObject({ ok: false, error: { kind: 'notOpenYet' } });
    expect(out).toMatchObject({ reconcileError: { kind: 'authExpired' } });
    expect(out).not.toHaveProperty('remainingPlan');
  });
});

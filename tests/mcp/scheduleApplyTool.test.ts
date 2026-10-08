import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../src/api/client.js';

vi.mock('../../src/runtimeContext.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtimeContext.js')>()),
  createClient: vi.fn(),
}));

import { createClient } from '../../src/runtimeContext.js';
import { scheduleApplyTool } from '../../src/mcp/tools.js';

const emptySchedule = { schedule: { reserved: [], favorites: [], personalTime: [] } };

describe('scheduleApplyTool', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
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

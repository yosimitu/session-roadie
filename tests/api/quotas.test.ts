import { describe, it, expect, vi } from 'vitest';
import { QuotaLimiter } from '../../src/api/quotas.js';

describe('QuotaLimiter', () => {
  it('quotas.htmlの表通り、ListSessionsは120回/分を上限とする', () => {
    const limiter = new QuotaLimiter();
    expect(limiter.quotaPerMinute('ListSessions')).toBe(120);
    expect(limiter.quotaPerMinute('GetSchedule')).toBe(60);
    expect(limiter.quotaPerMinute('ReserveSessions')).toBe(30);
  });

  it('429応答のRetry-Afterを尊重してから再実行する', async () => {
    const limiter = new QuotaLimiter();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('throttled') as Error & { status: number; retryAfterSeconds: number };
        err.status = 429;
        err.retryAfterSeconds = 0; // テストでは待機0秒
        throw err;
      }
      return 'ok';
    });
    const result = await limiter.withRetry(fn);
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});

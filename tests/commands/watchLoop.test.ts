import { describe, it, expect } from 'vitest';
import { parseIntervalMinutes, runWatchLoop, MIN_INTERVAL_MINUTES } from '../../src/commands/watchLoop.js';

describe('parseIntervalMinutes', () => {
  it('最短5分以上の整数を受け付ける', () => {
    expect(MIN_INTERVAL_MINUTES).toBe(5);
    expect(parseIntervalMinutes('5')).toBe(5);
    expect(parseIntervalMinutes('10')).toBe(10);
  });
  it('5分未満・整数でない・数でない値はエラー', () => {
    expect(() => parseIntervalMinutes('4')).toThrow('5分以上');
    expect(() => parseIntervalMinutes('7.5')).toThrow('5分以上');
    expect(() => parseIntervalMinutes('abc')).toThrow('5分以上');
    expect(() => parseIntervalMinutes('')).toThrow('5分以上');
  });
});

describe('runWatchLoop', () => {
  it('maxTicks 回だけ tick を呼び、間に sleep を挟む（最後の後は待たない）', async () => {
    const order: string[] = [];
    await runWatchLoop({
      tick: async () => { order.push('tick'); },
      intervalMs: 600_000,
      sleep: async (ms) => { order.push(`sleep:${ms}`); },
      isFatal: () => false,
      onError: () => {},
      maxTicks: 3,
    });
    expect(order).toEqual(['tick', 'sleep:600000', 'tick', 'sleep:600000', 'tick']);
  });

  it('致命的でないエラーは onError に渡して続ける', async () => {
    let n = 0;
    const errors: unknown[] = [];
    await runWatchLoop({
      tick: async () => { n += 1; if (n === 1) throw new Error('network'); },
      intervalMs: 1,
      sleep: async () => {},
      isFatal: () => false,
      onError: (e) => { errors.push(e); },
      maxTicks: 2,
    });
    expect(n).toBe(2);
    expect(errors).toHaveLength(1);
  });

  it('致命的なエラー（認証切れ）は投げて終了する', async () => {
    let n = 0;
    await expect(runWatchLoop({
      tick: async () => { n += 1; throw new Error('401'); },
      intervalMs: 1,
      sleep: async () => {},
      isFatal: () => true,
      onError: () => {},
      maxTicks: 5,
    })).rejects.toThrow('401');
    expect(n).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { getTravelMinutes } from '../../src/schedule/travelTime.js';

describe('getTravelMinutes', () => {
  it('同一会場なら移動時間0分', () => {
    expect(getTravelMinutes('Venetian', 'Venetian')).toBe(0);
  });

  it('既知の会場ペアは順序によらず同じ値を返す', () => {
    expect(getTravelMinutes('Venetian', 'Wynn')).toBe(getTravelMinutes('Wynn', 'Venetian'));
  });

  it('未知の会場は保守的な既定値（40分）を返す', () => {
    expect(getTravelMinutes('Venetian', '未知の会場')).toBe(40);
  });
});

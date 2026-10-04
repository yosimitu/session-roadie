import { describe, it, expect } from 'vitest';
import { getTravelMinutes } from '../../src/schedule/travelTime.js';

describe('getTravelMinutes', () => {
  it('同一会場なら移動時間0分', () => {
    expect(getTravelMinutes('Venetian', 'Venetian')).toBe(0);
  });

  it('既知の会場ペアは順序によらず同じ値を返す', () => {
    expect(getTravelMinutes('Venetian', 'Wynn')).toBe(getTravelMinutes('Wynn', 'Venetian'));
  });

  it('カタログの会場名（"MGM Grand" / "Caesars Forum"）をテーブルのキーに正規化して引く', () => {
    expect(getTravelMinutes('Caesars Forum', 'MGM Grand')).toBe(20);
    expect(getTravelMinutes('Venetian', 'MGM Grand')).toBe(35);
  });

  it('同じ会場の表記揺れは同一会場として0分', () => {
    expect(getTravelMinutes('MGM Grand', 'MGM')).toBe(0);
  });

  it('未知の会場は保守的な既定値（40分）を返す', () => {
    expect(getTravelMinutes('Venetian', '未知の会場')).toBe(40);
  });
});

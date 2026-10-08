import { describe, it, expect } from 'vitest';
import { getTravelMinutes, normalizeVenue } from '../../src/schedule/travelTime.js';

describe('getTravelMinutes', () => {
  it('同一会場なら移動時間0分', () => {
    expect(getTravelMinutes('Venetian', 'Venetian')).toBe(0);
  });

  it('既知の会場ペアは順序によらず同じ値を返す', () => {
    expect(getTravelMinutes('Venetian', 'Wynn')).toBe(getTravelMinutes('Wynn', 'Venetian'));
  });

  it('カタログの会場名（"MGM Grand" / "Caesars Palace"）をテーブルのキーに正規化して引く', () => {
    expect(getTravelMinutes('Caesars Palace', 'MGM Grand')).toBe(20);
    expect(getTravelMinutes('Venetian', 'MGM Grand')).toBe(30);
  });

  it('MGM Grand と Venetian・Wynn/Encore の間はシャトル前提で30分', () => {
    expect(getTravelMinutes('MGM Grand', 'Venetian')).toBe(30);
    expect(getTravelMinutes('MGM Grand', 'Wynn/Encore')).toBe(30);
    expect(getTravelMinutes('Wynn/Encore', 'MGM Grand')).toBe(30);
  });

  it('Caesars Palace と Caesars Forum は別会場として扱う（互いに0分ではない）', () => {
    expect(getTravelMinutes('Caesars Palace', 'Caesars Forum')).toBe(20);
    expect(getTravelMinutes('Caesars Forum', 'Caesars Palace')).toBe(20);
    expect(getTravelMinutes('Caesars Forum', 'MGM Grand')).toBe(30);
    expect(getTravelMinutes('Caesars Forum', 'Wynn/Encore')).toBe(15);
    expect(getTravelMinutes('Venetian', 'Caesars Forum')).toBe(15);
  });

  it('0.7マイル未満は徒歩、0.7〜1.2マイルのシャトルは20分、1.2マイル超のシャトルは30分', () => {
    // 徒歩（0.7マイル未満）。Venetian から Wynn/Encore・Forum は指定どおり15分
    expect(getTravelMinutes('Wynn/Encore', 'Venetian')).toBe(15);
    expect(getTravelMinutes('Venetian', 'Wynn/Encore')).toBe(15);
    expect(getTravelMinutes('Venetian', 'Caesars Forum')).toBe(15);
    expect(getTravelMinutes('Caesars Forum', 'Venetian')).toBe(15);
    expect(getTravelMinutes('Wynn/Encore', 'Caesars Forum')).toBe(15);
    expect(getTravelMinutes('Caesars Forum', 'Wynn/Encore')).toBe(15);
    // シャトル 1.2マイル以下（Venetian-Palace 0.7 / Forum-Palace 0.9 / Wynn・Encore-Palace 1.1 / MGM-Palace 1.2）
    expect(getTravelMinutes('Venetian', 'Caesars Palace')).toBe(20);
    expect(getTravelMinutes('Caesars Forum', 'Caesars Palace')).toBe(20);
    expect(getTravelMinutes('Wynn/Encore', 'Caesars Palace')).toBe(20);
    expect(getTravelMinutes('MGM Grand', 'Caesars Palace')).toBe(20);
    // シャトル 1.2マイル超（MGM-Forum 1.4 / MGM-Venetian 1.6 / MGM-Wynn・Encore 1.8）
    expect(getTravelMinutes('MGM Grand', 'Caesars Forum')).toBe(30);
  });

  it('カタログの全会場名（Caesars Palace / Caesars Forum / MGM Grand / Venetian / Wynn/Encore）が既知の会場に引ける', () => {
    const venues = ['Caesars Palace', 'Caesars Forum', 'MGM Grand', 'Venetian', 'Wynn/Encore'];
    expect(venues.map(normalizeVenue)).toEqual(['Caesars Palace', 'Caesars Forum', 'MGM', 'Venetian', 'Wynn']);
    for (const a of venues) {
      for (const b of venues) {
        if (a === b) continue;
        expect(getTravelMinutes(a, b)).toBe(getTravelMinutes(b, a));
        expect(getTravelMinutes(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it('会場名が "Caesars" だけなどPalace/Forumを判別できない場合は未知の会場（40分）として扱う', () => {
    expect(getTravelMinutes('Caesars', 'MGM Grand')).toBe(40);
  });

  it('同じ会場の表記揺れは同一会場として0分', () => {
    expect(getTravelMinutes('MGM Grand', 'MGM')).toBe(0);
  });

  it('未知の会場は、テーブルの最長（30分）を上回る保守的な既定値（40分）を返す', () => {
    expect(getTravelMinutes('Venetian', '未知の会場')).toBe(40);
  });
});

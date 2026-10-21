import { describe, it, expect } from 'vitest';
import { CLIENT, PAGE, STATUS, parseLang } from '../../src/reporting/i18n.js';

describe('parseLang', () => {
  it('省略時は ja、ja と en はそのまま返す', () => {
    expect(parseLang(undefined)).toBe('ja');
    expect(parseLang('ja')).toBe('ja');
    expect(parseLang('en')).toBe('en');
  });

  it('それ以外はエラーにする', () => {
    expect(() => parseLang('fr')).toThrow('lang は ja か en');
  });
});

describe('文言の辞書', () => {
  it('日本語と英語で、配列の長さと {0} 形式の差し込みの数が揃っている', () => {
    const arrays = ['weekdays', 'timeBands', 'dims', 'stats', 'overview', 'csvHeader'] as const;
    for (const key of arrays) expect(CLIENT.en[key]).toHaveLength(CLIENT.ja[key].length);
    expect(Object.keys(STATUS.en)).toEqual(Object.keys(STATUS.ja));
    expect(Object.keys(PAGE.en)).toEqual(Object.keys(PAGE.ja));
    const slots = (t: string) => (t.match(/\{\d\}/g) ?? []).sort().join();
    for (const [key, ja] of Object.entries(CLIENT.ja)) {
      const en = (CLIENT.en as unknown as Record<string, unknown>)[key];
      if (typeof ja === 'string') expect(slots(en as string), key).toBe(slots(ja));
    }
  });
});

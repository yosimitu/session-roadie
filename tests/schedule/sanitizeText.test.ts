import { describe, it, expect } from 'vitest';
import { sanitizeForPersonalTime } from '../../src/schedule/sanitizeText.js';

describe('sanitizeForPersonalTime', () => {
  it('半角の角括弧を全角に置き換える（2026-09-28実データ: [/]を含むと400になるため）', () => {
    expect(sanitizeForPersonalTime('[Test] bracket check')).toBe('〔Test〕 bracket check');
  });

  it('日本語テキストはそのまま通す', () => {
    expect(sanitizeForPersonalTime('テスト予定')).toBe('テスト予定');
  });

  it('角括弧を含まないASCIIはそのまま通す', () => {
    expect(sanitizeForPersonalTime('Test bracket check without brackets')).toBe('Test bracket check without brackets');
  });
});

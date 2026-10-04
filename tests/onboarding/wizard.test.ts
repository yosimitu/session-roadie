import { describe, it, expect } from 'vitest';
import { buildProfileFromOnboarding, buildIntentFromOnboarding, type OnboardingAnswers } from '../../src/onboarding/wizard.js';

describe('buildProfileFromOnboarding', () => {
  it('普段の仕事をroleに変換し、目的・体力もそのまま保存する', () => {
    const answers: OnboardingAnswers = { role: 'infrastructure', purpose: 'learning', stamina: 'normal' };
    expect(buildProfileFromOnboarding(answers)).toEqual({ role: 'インフラ', purpose: 'learning', stamina: 'normal' });
  });

  it('参加日と関心テーマを保存し、関心テーマはカタログのtopicsに変換する', () => {
    const profile = buildProfileFromOnboarding({
      role: 'data', purpose: 'research', stamina: 'relaxed',
      firstDay: '2026-11-30', lastDay: '2026-12-02', interests: ['agenticAI', 'security'],
    });
    expect(profile.attendance).toEqual({ firstDay: '2026-11-30', lastDay: '2026-12-02' });
    expect(profile.mainTheme).toEqual(['Agentic AI・生成AI', 'セキュリティ']);
    expect(profile.interestTopics).toEqual(['Artificial Intelligence', 'Business Agents', 'Security & Identity']);
  });

  it('関心テーマが「特になし」（空配列）ならmainTheme/interestTopicsを書かない', () => {
    const profile = buildProfileFromOnboarding({ role: 'appDev', purpose: 'learning', stamina: 'packed', interests: [] });
    expect(profile.mainTheme).toBeUndefined();
    expect(profile.interestTopics).toBeUndefined();
  });

  it('初日が最終日より後ならエラー', () => {
    expect(() => buildProfileFromOnboarding({
      role: 'appDev', purpose: 'learning', stamina: 'packed', firstDay: '2026-12-03', lastDay: '2026-12-01',
    })).toThrow('参加日の指定が逆');
  });
});

describe('buildIntentFromOnboarding', () => {
  it('目的と体力から自由文の意図を組み立てる', () => {
    const answers: OnboardingAnswers = { role: 'data', purpose: 'report', stamina: 'relaxed' };
    const intent = buildIntentFromOnboarding(answers);
    expect(intent).toContain('社内報告');
    expect(intent).toContain('余裕を持った');
  });

  it('詰め込みたい場合は体力面の文言が変わる', () => {
    const intent = buildIntentFromOnboarding({ role: 'appDev', purpose: 'learning', stamina: 'packed' });
    expect(intent).toContain('詰め込んで');
  });

  it('参加日と関心テーマも意図の文に含める', () => {
    const intent = buildIntentFromOnboarding({
      role: 'data', purpose: 'learning', stamina: 'normal', firstDay: '2026-12-01', lastDay: '2026-12-03', interests: ['data'],
    });
    expect(intent).toContain('12/1〜12/3');
    expect(intent).toContain('データ・分析');
  });
});

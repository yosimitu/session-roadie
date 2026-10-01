import { describe, it, expect } from 'vitest';
import { buildProfileFromOnboarding, buildIntentFromOnboarding, type OnboardingAnswers } from '../../src/onboarding/wizard.js';

describe('buildProfileFromOnboarding', () => {
  it('普段の仕事をroleに変換する（企画書 §5.1 初参加者向けの3質問）', () => {
    const answers: OnboardingAnswers = { role: 'infrastructure', purpose: 'learning', stamina: 'normal' };
    expect(buildProfileFromOnboarding(answers).role).toBe('インフラ');
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
});

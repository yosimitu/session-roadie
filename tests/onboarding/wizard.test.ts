import { describe, it, expect } from 'vitest';
import { buildProfileFromOnboarding, buildIntentFromOnboarding, parseFixedEvent, type OnboardingAnswers } from '../../src/onboarding/wizard.js';

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

  it('希望レベル・スポンサー・開始時刻・昼休み・固定の予定も意図の文に含める', () => {
    const intent = buildIntentFromOnboarding({
      role: 'data', purpose: 'learning', stamina: 'normal',
      maxLevel: 300, excludeSponsored: true, earliestStart: '09:00', lunchBreak: true,
      fixedEvents: [{ date: '2026-12-01', start: '18:00', end: '20:00', title: '会食' }],
    });
    expect(intent).toContain('レベル300まで');
    expect(intent).toContain('スポンサーセッションは避けたい');
    expect(intent).toContain('9:00より前');
    expect(intent).toContain('昼休み（12:00〜13:00）にかかるセッションは、あれば知らせて');
    expect(intent).toContain('12/1 18:00〜20:00 会食');
  });
});

describe('buildProfileFromOnboarding（精度向上のための追加質問）', () => {
  const base: OnboardingAnswers = { role: 'infrastructure', purpose: 'learning', stamina: 'normal' };

  it('希望レベル・スポンサー除外・開始時刻・昼休み・固定の予定を保存する', () => {
    const fixedEvents = [{ date: '2026-12-01', start: '18:00', end: '20:00', title: '会食' }];
    const profile = buildProfileFromOnboarding({
      ...base, maxLevel: 300, excludeSponsored: true, earliestStart: '09:00', lunchBreak: true, fixedEvents,
    });
    expect(profile).toMatchObject({ maxLevel: 300, excludeSponsored: true, earliestStart: '09:00', lunchBreak: true, fixedEvents });
  });

  it('未回答・既定値（false・空配列）の項目はプロフィールに書かない', () => {
    const profile = buildProfileFromOnboarding({ ...base, excludeSponsored: false, lunchBreak: false, fixedEvents: [] });
    expect(profile).toEqual({ role: 'インフラ', purpose: 'learning', stamina: 'normal' });
  });

  it('開始時刻が HH:MM 形式でなければエラー', () => {
    expect(() => buildProfileFromOnboarding({ ...base, earliestStart: '9時' })).toThrow('開始時刻');
  });

  it('固定の予定は会期内の日付で、開始が終了より前でなければエラー', () => {
    expect(() => buildProfileFromOnboarding({ ...base, fixedEvents: [{ date: '2026-12-09', start: '18:00', end: '20:00', title: 'x' }] }))
      .toThrow('会期外');
    expect(() => buildProfileFromOnboarding({ ...base, fixedEvents: [{ date: '2026-12-01', start: '20:00', end: '18:00', title: 'x' }] }))
      .toThrow('開始');
  });
});

describe('themePriority（関心テーマの優先順位）', () => {
  const base: OnboardingAnswers = {
    role: 'infrastructure', purpose: 'learning', stamina: 'normal', interests: ['agenticAI', 'security', 'migration'],
  };

  it('優先順位を、テーマの表示名の並びとして保存する', () => {
    const profile = buildProfileFromOnboarding({ ...base, themePriority: ['security', 'agenticAI'] });
    expect(profile.themePriority).toEqual(['セキュリティ', 'Agentic AI・生成AI']);
  });

  it('省略・空なら保存しない', () => {
    expect(buildProfileFromOnboarding(base).themePriority).toBeUndefined();
    expect(buildProfileFromOnboarding({ ...base, themePriority: [] }).themePriority).toBeUndefined();
  });

  it('関心テーマに入っていないものや、重複はエラー', () => {
    expect(() => buildProfileFromOnboarding({ ...base, themePriority: ['data'] })).toThrow('優先順位');
    expect(() => buildProfileFromOnboarding({ ...base, themePriority: ['security', 'security'] })).toThrow('優先順位');
  });

  it('関心テーマを選んでいないのに優先順位だけ指定したらエラー', () => {
    expect(() => buildProfileFromOnboarding({ role: 'data', purpose: 'learning', stamina: 'normal', themePriority: ['data'] })).toThrow('優先順位');
  });

  it('意図の文に、優先順位を含める', () => {
    const intent = buildIntentFromOnboarding({ ...base, themePriority: ['security', 'agenticAI'] });
    expect(intent).toContain('優先したいのは セキュリティ、Agentic AI・生成AI の順');
  });
});

describe('parseFixedEvent', () => {
  it('「M/D HH:MM-HH:MM タイトル」を会期の日付に解釈する', () => {
    expect(parseFixedEvent('12/1 18:00-20:00 会食')).toEqual({ date: '2026-12-01', start: '18:00', end: '20:00', title: '会食' });
    expect(parseFixedEvent('11/30 9:30-10:30 社内MTG')).toEqual({ date: '2026-11-30', start: '09:30', end: '10:30', title: '社内MTG' });
  });

  it('形式が違う入力や、会期外・時刻が逆の入力はエラー', () => {
    expect(() => parseFixedEvent('会食')).toThrow('形式');
    expect(() => parseFixedEvent('12/9 18:00-20:00 会食')).toThrow('会期外');
    expect(() => parseFixedEvent('12/1 20:00-18:00 会食')).toThrow('開始');
  });
});

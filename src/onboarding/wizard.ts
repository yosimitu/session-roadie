import type { Profile } from '../profile/profileStore.js';

// 企画書 §5.1「初参加者向けの入口」: 興味ではなく立場を聞く3つの質問。
// YAMLを見せずに、初期プロフィール・意図を組み立てる。

export type OnboardingRole = 'infrastructure' | 'appDev' | 'data' | 'management';
export type OnboardingPurpose = 'learning' | 'research' | 'networking' | 'report';
export type OnboardingStamina = 'packed' | 'normal' | 'relaxed';

export interface OnboardingAnswers {
  role: OnboardingRole;
  purpose: OnboardingPurpose;
  stamina: OnboardingStamina;
}

const ROLE_LABELS: Record<OnboardingRole, string> = {
  infrastructure: 'インフラ',
  appDev: 'アプリ開発',
  data: 'データ',
  management: '管理職',
};

const PURPOSE_PHRASES: Record<OnboardingPurpose, string> = {
  learning: '学習を中心に',
  research: '情報収集を中心に',
  networking: '人脈作りを中心に',
  report: '社内報告につながる内容を中心に',
};

const STAMINA_PHRASES: Record<OnboardingStamina, string> = {
  packed: '隙間なく詰め込んでセッションを回りたいです。',
  normal: '普通のペースで無理のない範囲にしたいです。',
  relaxed: '余裕を持ったスケジュールにしたいです。',
};

export function buildProfileFromOnboarding(answers: OnboardingAnswers): Partial<Profile> {
  return { role: ROLE_LABELS[answers.role] };
}

export function buildIntentFromOnboarding(answers: OnboardingAnswers): string {
  return `${PURPOSE_PHRASES[answers.purpose]}セッションを選んでください。${STAMINA_PHRASES[answers.stamina]}`;
}

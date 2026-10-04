import type { Profile, Purpose, Stamina } from '../profile/profileStore.js';

// 企画書 §5.1「初参加者向けの入口」: 興味ではなく立場を聞く3つの質問が基本。
// 予定の中身を直接左右する「参加日」と、任意の「関心テーマ」（「特になし」可）を加えた。
// YAMLを見せずに、初期プロフィール・意図を組み立てる。

export type OnboardingRole = 'infrastructure' | 'appDev' | 'data' | 'management';
export type OnboardingPurpose = Purpose;
export type OnboardingStamina = Stamina;
export type OnboardingInterest = 'agenticAI' | 'security' | 'data' | 'appDev' | 'infrastructure' | 'migration';

/** re:Invent 2026 の会期（会場PST）。参加日の選択肢に使う */
export const ONBOARDING_EVENT_DATES = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'] as const;

export interface OnboardingAnswers {
  role: OnboardingRole;
  purpose: OnboardingPurpose;
  stamina: OnboardingStamina;
  firstDay?: string;
  lastDay?: string;
  interests?: OnboardingInterest[]; // 空・省略は「特になし」
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

// topics はカタログに実在する値（2026-10-01実データ）
export const INTEREST_OPTIONS: Record<OnboardingInterest, { label: string; topics: string[] }> = {
  agenticAI: { label: 'Agentic AI・生成AI', topics: ['Artificial Intelligence', 'Business Agents'] },
  security: { label: 'セキュリティ', topics: ['Security & Identity'] },
  data: { label: 'データ・分析', topics: ['Databases', 'Analytics'] },
  appDev: { label: 'アプリ開発・サーバーレス', topics: ['Serverless', 'Containers', 'Developer Tools', 'Application Integration'] },
  infrastructure: { label: 'インフラ・ネットワーク', topics: ['Compute', 'Networking & Content Delivery', 'Storage', 'Hybrid Cloud & Multicloud'] },
  migration: { label: '移行・運用', topics: ['Migration & Modernization', 'Cloud Operations'] },
};

function formatDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day}`;
}

export function buildProfileFromOnboarding(answers: OnboardingAnswers): Profile {
  if (answers.firstDay && answers.lastDay && answers.firstDay > answers.lastDay) {
    throw new Error(`参加日の指定が逆です（初日 ${answers.firstDay} が最終日 ${answers.lastDay} より後）`);
  }
  const interests = answers.interests ?? [];
  const profile: Profile = { role: ROLE_LABELS[answers.role], purpose: answers.purpose, stamina: answers.stamina };
  if (answers.firstDay || answers.lastDay) profile.attendance = { firstDay: answers.firstDay, lastDay: answers.lastDay };
  if (interests.length > 0) {
    profile.mainTheme = interests.map((i) => INTEREST_OPTIONS[i].label);
    profile.interestTopics = [...new Set(interests.flatMap((i) => INTEREST_OPTIONS[i].topics))];
  }
  return profile;
}

export function buildIntentFromOnboarding(answers: OnboardingAnswers): string {
  const parts = [`${PURPOSE_PHRASES[answers.purpose]}セッションを選んでください。${STAMINA_PHRASES[answers.stamina]}`];
  if (answers.firstDay || answers.lastDay) {
    const from = answers.firstDay ? formatDay(answers.firstDay) : '初日';
    const to = answers.lastDay ? formatDay(answers.lastDay) : '最終日';
    parts.push(`参加できるのは${from}〜${to}です。`);
  }
  if (answers.interests?.length) {
    parts.push(`関心があるのは${answers.interests.map((i) => INTEREST_OPTIONS[i].label).join('、')}です。`);
  }
  return parts.join('');
}

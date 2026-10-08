import type { FixedEvent, Profile, Purpose, Stamina } from '../profile/profileStore.js';

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
  themePriority?: OnboardingInterest[]; // 関心テーマの優先順位（1位から。interests に含まれるもの。省略は順位なし）
  maxLevel?: 200 | 300; // 省略は制限なし
  excludeSponsored?: boolean;
  earliestStart?: string; // "HH:MM"（会場現地）。省略は制限なし
  lunchBreak?: boolean;
  fixedEvents?: FixedEvent[];
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

/** "9:00" → "09:00"。HH:MM として読めなければ undefined */
function normalizeTime(value: string): string | undefined {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function normalizeFixedEvent(event: FixedEvent): FixedEvent {
  const start = normalizeTime(event.start);
  const end = normalizeTime(event.end);
  const title = event.title.trim();
  if (!(ONBOARDING_EVENT_DATES as readonly string[]).includes(event.date)) {
    throw new Error(`固定の予定の日付 ${event.date} が会期外です（${ONBOARDING_EVENT_DATES[0]}〜${ONBOARDING_EVENT_DATES[ONBOARDING_EVENT_DATES.length - 1]}）`);
  }
  if (!start || !end) throw new Error(`固定の予定の時刻は HH:MM 形式で指定してください（${event.start}〜${event.end}）`);
  if (start >= end) throw new Error(`固定の予定の開始時刻 ${start} が終了時刻 ${end} 以降です`);
  if (!title) throw new Error('固定の予定のタイトルが空です');
  return { date: event.date, start, end, title };
}

/** 「M/D HH:MM-HH:MM タイトル」（例: "12/1 18:00-20:00 会食"）を会期の固定の予定に変換する */
export function parseFixedEvent(line: string): FixedEvent {
  const m = line.trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\s*[-~〜－–]\s*(\d{1,2}:\d{2})\s+(\S.*)$/);
  if (!m) throw new Error('形式が違います。「12/1 18:00-20:00 会食」のように入力してください');
  const date = `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return normalizeFixedEvent({ date, start: m[3], end: m[4], title: m[5] });
}

export function buildProfileFromOnboarding(answers: OnboardingAnswers): Profile {
  if (answers.firstDay && answers.lastDay && answers.firstDay > answers.lastDay) {
    throw new Error(`参加日の指定が逆です（初日 ${answers.firstDay} が最終日 ${answers.lastDay} より後）`);
  }
  const interests = answers.interests ?? [];
  const profile: Profile = { role: ROLE_LABELS[answers.role], purpose: answers.purpose, stamina: answers.stamina };
  if (answers.firstDay || answers.lastDay) profile.attendance = { firstDay: answers.firstDay, lastDay: answers.lastDay };
  if (answers.maxLevel) profile.maxLevel = answers.maxLevel;
  if (answers.excludeSponsored) profile.excludeSponsored = true;
  if (answers.earliestStart !== undefined) {
    const earliestStart = normalizeTime(answers.earliestStart);
    if (!earliestStart) throw new Error(`開始時刻 ${answers.earliestStart} は HH:MM 形式で指定してください`);
    profile.earliestStart = earliestStart;
  }
  if (answers.lunchBreak) profile.lunchBreak = true;
  if (answers.fixedEvents?.length) profile.fixedEvents = answers.fixedEvents.map(normalizeFixedEvent);
  if (answers.themePriority?.length) {
    const picked = new Set(answers.interests ?? []);
    const unknown = answers.themePriority.filter((t) => !picked.has(t));
    if (unknown.length > 0) throw new Error(`優先順位に、関心テーマとして選んでいないものが含まれています（${unknown.join('、')}）`);
    if (new Set(answers.themePriority).size !== answers.themePriority.length) throw new Error('優先順位に、同じテーマが重複しています');
    profile.themePriority = answers.themePriority.map((t) => INTEREST_OPTIONS[t].label);
  }
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
  if (answers.maxLevel) parts.push(`レベル${answers.maxLevel}までのセッションを希望します。`);
  if (answers.excludeSponsored) parts.push('スポンサーセッションは避けたいです。');
  if (answers.earliestStart !== undefined) {
    const time = normalizeTime(answers.earliestStart);
    if (time) parts.push(`${Number(time.slice(0, 2))}${time.slice(2)}より前に始まるセッションは避けたいです。`);
  }
  if (answers.lunchBreak) parts.push('昼休み（12:00〜13:00）にかかるセッションは、あれば知らせてほしいです。');
  if (answers.themePriority?.length) {
    parts.push(`優先したいのは ${answers.themePriority.map((i) => INTEREST_OPTIONS[i].label).join('、')} の順です。`);
  }
  if (answers.fixedEvents?.length) {
    const labels = answers.fixedEvents.map((e) => `${formatDay(e.date)} ${e.start}〜${e.end} ${e.title}`);
    parts.push(`固定の予定があります（${labels.join('、')}）。`);
  }
  return parts.join('');
}

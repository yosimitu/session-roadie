import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

export type Purpose = 'learning' | 'research' | 'networking' | 'report';
export type Stamina = 'packed' | 'normal' | 'relaxed';

/** 会食・社内会議など、参加者が会期中に動かせない予定（会場現地の日付・時刻） */
export interface FixedEvent {
  date: string; // "YYYY-MM-DD"
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  title: string;
}

export interface Profile {
  role?: string;
  purpose?: Purpose;
  stamina?: Stamina;
  attendance?: { firstDay?: string; lastDay?: string }; // 会場（PST）の日付 "YYYY-MM-DD"
  maxLevel?: 200 | 300; // これより上のレベルのセッションを検索から除く。未設定は制限なし
  excludeSponsored?: boolean; // スポンサーセッション（略称 -S）を検索から除く
  earliestStart?: string; // これより前に始まるセッションを避ける（会場現地 "HH:MM"）
  lunchBreak?: boolean; // 予約するセッションが 12:00〜13:00 にかかるとき警告する（除外はしない）
  fixedEvents?: FixedEvent[];
  interestTopics?: string[]; // カタログの topics の値（例 "Security & Identity"）
  yearsOfExperience?: number;
  certifications?: string[];
  upcomingCertifications?: string[];
  strongTopics?: string[];
  weakTopics?: string[];
  mainTheme?: string[];
  themePriority?: string[]; // mainTheme の表示名を、優先順（1位から）に並べたもの。おすすめの重みを、お気に入りの傾向より優先して決める
  englishListening?: 'confident' | 'captionsOk' | 'anxious';
  homeTimezone?: string;
}

export function loadProfile(path: string): Profile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = parse(raw) as Profile;
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}

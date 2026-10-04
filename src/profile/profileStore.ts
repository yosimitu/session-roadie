import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

export type Purpose = 'learning' | 'research' | 'networking' | 'report';
export type Stamina = 'packed' | 'normal' | 'relaxed';

export interface Profile {
  role?: string;
  purpose?: Purpose;
  stamina?: Stamina;
  attendance?: { firstDay?: string; lastDay?: string }; // 会場（PST）の日付 "YYYY-MM-DD"
  interestTopics?: string[]; // カタログの topics の値（例 "Security & Identity"）
  yearsOfExperience?: number;
  certifications?: string[];
  upcomingCertifications?: string[];
  strongTopics?: string[];
  weakTopics?: string[];
  mainTheme?: string[];
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

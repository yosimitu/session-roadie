import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

export interface Profile {
  role?: string;
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

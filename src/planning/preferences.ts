import type { Profile, Purpose, Stamina } from '../profile/profileStore.js';
import type { OptimizeOptions } from './optimize.js';

// オンボーディングの回答（profile.yaml）を、schedule_optimize / catalog_search の既定値に変換する。
// 数値と形式の対応は企画書に根拠のない仮置き。実地で使ってみて調整する。

const STAMINA_LIMITS: Record<Stamina, Pick<OptimizeOptions, 'maxSessionsPerDay' | 'minGapMinutes'>> = {
  packed: {},
  normal: { maxSessionsPerDay: 4, minGapMinutes: 15 },
  relaxed: { maxSessionsPerDay: 3, minGapMinutes: 30 },
};

// 学習は手を動かす形式、情報収集は広く聞ける形式、人脈は少人数で対話できる形式、
// 社内報告はスライドが共有されやすい講演形式を優先する
const PURPOSE_TYPES: Record<Purpose, string[]> = {
  learning: ['Workshop', "Builders' session", 'Code talk', 'Lab', 'Bootcamp', 'Gamified learning'],
  research: ['Breakout session', 'Lightning talk'],
  networking: ['Chalk talk', "Builders' session"],
  report: ['Breakout session'],
};

export type ProfileOptimizeDefaults = Pick<OptimizeOptions, 'maxSessionsPerDay' | 'minGapMinutes' | 'preferredTypes' | 'dateRange'>;

export function optimizeDefaultsFromProfile(profile: Profile | undefined): ProfileOptimizeDefaults {
  if (!profile) return {};
  const attendance = profile.attendance;
  return {
    ...(profile.stamina ? STAMINA_LIMITS[profile.stamina] : {}),
    ...(profile.purpose ? { preferredTypes: PURPOSE_TYPES[profile.purpose] } : {}),
    ...(attendance?.firstDay || attendance?.lastDay ? { dateRange: { firstDay: attendance.firstDay, lastDay: attendance.lastDay } } : {}),
  };
}

/** 参加日の範囲に入る日付だけを残す（catalog_search の dates 既定値用） */
export function datesWithinAttendance(eventDates: readonly string[], profile: Profile | undefined): string[] | undefined {
  const firstDay = profile?.attendance?.firstDay;
  const lastDay = profile?.attendance?.lastDay;
  if (!firstDay && !lastDay) return undefined;
  return eventDates.filter((d) => (!firstDay || d >= firstDay) && (!lastDay || d <= lastDay));
}

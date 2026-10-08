import type { Session } from '../api/types.js';
import type { Profile } from '../profile/profileStore.js';
import { INTEREST_OPTIONS } from '../onboarding/wizard.js';
import { JA_LABELS } from '../reporting/jaLabels.js';
import { getTravelMinutes } from '../schedule/travelTime.js';
import { isSponsored } from '../catalog/search.js';
import { optimizeDefaultsFromProfile } from './preferences.js';

// 「おすすめ」を決める。LLM は使わず、説明できる点数だけで決める（予定表HTMLに埋め込んで、ブラウザで並べ替える）。
//
// トピックの重み（0〜1）
//   基本: お気に入り（公式）に入っているセッションのトピックの出現回数（最多を1として比例）。関心トピック（プロフィール）は最低0.5。
//   上書き: プロフィールの優先順位（themePriority）があれば、そのテーマのトピックは 1位=1、最下位=0.5、間は等間隔にする。
// 点数（80点満点を100点に換算）
//   トピック 最大40 + 優先形式 10 + 空席 10（残りわずかは5） + 予定に収まる 15 + 新着 5
// おすすめにしないもの
//   予約済み、満席・ウォークアップ、予約・個人予定・固定の予定と重なる、移動時間や最低空き時間が足りない、1日の上限、
//   参加日の外、希望レベル超え、スポンサー除外、開始時刻より前、トピックの重みが0のもの

export const RECOMMEND_THRESHOLD = 60;

const POINTS = { topic: 40, type: 10, seatOpen: 10, seatVeryLimited: 5, fit: 15, isNew: 5 };
const MAX_POINTS = POINTS.topic + POINTS.type + POINTS.seatOpen + POINTS.fit + POINTS.isNew;
const INTEREST_BASE_WEIGHT = 0.5;
const DEFAULT_LENGTH_MINUTES = 30;

/** 個人予定など、会場現地の日付・時刻（分）で表した、予定が入っている時間帯 */
export interface BusyRange {
  date: string;
  start: number;
  end: number;
}

export interface RecommendInput {
  sessions: Session[];
  reservedIds: string[];
  favoriteIds: string[];
  busy: BusyRange[];
  profile?: Profile;
  newIds?: Set<string>;
}

export interface Recommendation {
  score: number; // 0-100
  reasons: string[];
}

export interface RecipeTopic {
  topic: string;
  weight: number;
  source: 'priority' | 'favorites' | 'interest';
  rank?: number; // priority のときの順位（1位から）
}

export interface RecommendResult {
  byId: Map<string, Recommendation>; // おすすめになったセッションだけ
  recipe: RecipeTopic[]; // 使ったトピックの重み（大きい順）
}

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const ja = (value: string): string => JA_LABELS[value] ?? value;

interface Slot {
  date: string;
  start: number;
  end: number;
}

function slotOf(s: Session): Slot | undefined {
  const { date, time, length } = s.sessionTime ?? {};
  if (!date || !time) return undefined;
  const start = toMinutes(time);
  return Number.isNaN(start) ? undefined : { date, start, end: start + (Number(length) || DEFAULT_LENGTH_MINUTES) };
}

const overlaps = (a: Slot, b: { start: number; end: number }): boolean => a.start < b.end && b.start < a.end;

function topicWeights(sessions: Session[], favoriteIds: string[], profile?: Profile): Map<string, RecipeTopic> {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const counts = new Map<string, number>();
  for (const id of favoriteIds) {
    for (const topic of byId.get(id)?.topics ?? []) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  const interest = new Set(profile?.interestTopics ?? []);

  const weights = new Map<string, RecipeTopic>();
  for (const topic of new Set([...counts.keys(), ...interest])) {
    const fav = max > 0 ? (counts.get(topic) ?? 0) / max : 0;
    const base = interest.has(topic) ? INTEREST_BASE_WEIGHT : 0;
    if (fav > 0 && fav >= base) weights.set(topic, { topic, weight: fav, source: 'favorites' });
    else if (base > 0) weights.set(topic, { topic, weight: base, source: 'interest' });
  }

  // 優先順位があれば、お気に入りの傾向より優先して上書きする
  const themes = (profile?.themePriority ?? [])
    .map((label) => Object.values(INTEREST_OPTIONS).find((o) => o.label === label))
    .filter((o): o is (typeof INTEREST_OPTIONS)[keyof typeof INTEREST_OPTIONS] => Boolean(o));
  themes.forEach((theme, i) => {
    const weight = themes.length > 1 ? 1 - (0.5 * i) / (themes.length - 1) : 1;
    for (const topic of theme.topics) {
      const current = weights.get(topic);
      if (current?.source === 'priority' && current.weight >= weight) continue;
      weights.set(topic, { topic, weight, source: 'priority', rank: i + 1 });
    }
  });
  return weights;
}

export function recommendSessions(input: RecommendInput): RecommendResult {
  const { sessions, reservedIds, favoriteIds, busy, profile } = input;
  const newIds = input.newIds ?? new Set<string>();
  const weights = topicWeights(sessions, favoriteIds, profile);
  const defaults = optimizeDefaultsFromProfile(profile);
  const minGap = defaults.minGapMinutes ?? 0;
  const maxPerDay = defaults.maxSessionsPerDay ?? Infinity;
  const preferredTypes = new Set((defaults.preferredTypes ?? []).map((t) => t.toLowerCase()));

  const reservedSet = new Set(reservedIds);
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const reserved = reservedIds.flatMap((id) => {
    const s = byId.get(id);
    const slot = s && slotOf(s);
    return s && slot ? [{ session: s, slot }] : [];
  });
  const reservedPerDay = new Map<string, number>();
  for (const r of reserved) reservedPerDay.set(r.slot.date, (reservedPerDay.get(r.slot.date) ?? 0) + 1);

  const blocked = (s: Session, slot: Slot): boolean => {
    if (s.seatAvailability === 'unavailable' || s.seatAvailability === 'walkUp') return true;
    const level = Number(s.level?.match(/^\d{3}/)?.[0]);
    if (profile?.maxLevel && Number.isFinite(level) && level > profile.maxLevel) return true;
    if (profile?.excludeSponsored && isSponsored(s)) return true;
    const { firstDay, lastDay } = profile?.attendance ?? {};
    if ((firstDay && slot.date < firstDay) || (lastDay && slot.date > lastDay)) return true;
    if (profile?.earliestStart && slot.start < toMinutes(profile.earliestStart)) return true;
    for (const e of profile?.fixedEvents ?? []) {
      if (e.date === slot.date && overlaps(slot, { start: toMinutes(e.start), end: toMinutes(e.end) })) return true;
    }
    if (busy.some((b) => b.date === slot.date && overlaps(slot, b))) return true;
    if ((reservedPerDay.get(slot.date) ?? 0) >= maxPerDay) return true;
    for (const r of reserved) {
      if (r.slot.date !== slot.date) continue;
      if (overlaps(slot, r.slot)) return true;
      const gap = slot.start >= r.slot.end ? slot.start - r.slot.end : r.slot.start - slot.end;
      const travel = r.session.venue && s.venue ? getTravelMinutes(r.session.venue, s.venue) : 0;
      if (gap < Math.max(travel, minGap)) return true;
    }
    return false;
  };

  const byIdResult = new Map<string, Recommendation>();
  for (const s of sessions) {
    if (reservedSet.has(s.sessionId)) continue;
    const slot = slotOf(s);
    if (!slot || blocked(s, slot)) continue;

    const best = (s.topics ?? []).map((t) => weights.get(t)).filter((w): w is RecipeTopic => Boolean(w))
      .sort((a, b) => b.weight - a.weight)[0];
    if (!best) continue;

    let points = POINTS.topic * best.weight;
    const reasons: string[] = [
      best.source === 'priority' ? `優先${best.rank}位: ${ja(best.topic)}`
        : best.source === 'favorites' ? `お気に入りの傾向: ${ja(best.topic)}` : `関心: ${ja(best.topic)}`,
    ];
    if (s.type && preferredTypes.has(s.type.toLowerCase())) {
      points += POINTS.type;
      reasons.push(`形式: ${ja(s.type)}`);
    }
    if (s.seatAvailability === 'available') {
      points += POINTS.seatOpen;
      reasons.push('空席あり');
    } else if (s.seatAvailability === 'limited') {
      points += POINTS.seatOpen;
      reasons.push('残り少なめ');
    } else if (s.seatAvailability === 'veryLimited') {
      points += POINTS.seatVeryLimited;
      reasons.push('残りわずか');
    }
    points += POINTS.fit;
    reasons.push('予定に収まる');
    if (newIds.has(s.sessionId)) {
      points += POINTS.isNew;
      reasons.push('新着');
    }
    byIdResult.set(s.sessionId, { score: Math.round((points / MAX_POINTS) * 100), reasons });
  }

  const recipe = [...weights.values()].sort((a, b) => b.weight - a.weight || a.topic.localeCompare(b.topic));
  return { byId: byIdResult, recipe };
}

import type { PersonalTime, Session } from '../api/types.js';
import type { FixedEvent } from '../profile/profileStore.js';
import { sessionStartUtc, sessionEndUtc } from '../schedule/sessionTimeUtc.js';
import { blockingPersonalTimes, personalTimeRangeUtc } from '../schedule/blockingPersonalTime.js';
import { ARRIVAL_BUFFER_MINUTES, getTravelMinutes } from '../schedule/travelTime.js';
import { baseAbbreviation } from './alternatives.js';

// 候補セッション（「見たいもの」）から、再演への差し替えと個人予定（基調講演など）を考慮して、
// 重ならずに参加できる本数が最大になる組み合わせを選ぶ。本数が同じなら優先形式の多い解、
// それも同じなら指定された回からの差し替えが少ない解を選ぶ。
// 1候補につき1回だけ選ぶ区間スケジューリングは一般にNP困難なので、枝刈り付きの全探索にノード数上限を設ける。

export interface OptimizeOptions {
  considerTravelTime?: boolean; // 既定true。会場が分かる連続セッション間に移動時間（travelTime.tsの概算値）を要求する
  maxSessionsPerDay?: number; // 1日（会場PSTの日付）あたりの上限本数
  minGapMinutes?: number; // 連続するセッション間に最低限あける分数（移動時間と大きい方を要求する）
  preferredTypes?: string[]; // 優先する形式（例 "Workshop"）。本数が同じ解の中で多く含む方を選ぶ
  dateRange?: { firstDay?: string; lastDay?: string }; // 参加できる日（会場PSTの "YYYY-MM-DD"、両端を含む）
  earliestStart?: string; // これより前に始まる回を避ける（会場現地の "HH:MM"）
  lunchBreak?: boolean; // 選んだ回が12:00〜13:00（会場現地）にかかるとき warnings で知らせる。回は除外しない。ちょうど12:00終了・13:00開始は警告なし
  fixedEvents?: FixedEvent[]; // 会食など動かせない予定（会場現地）。重なる回を避ける。公式アプリには書き込まない
  maxNodes?: number;
}

export type Blocker =
  | { kind: 'session'; sessionId: string; title: string; requiredTravelMinutes?: number; arrivalBufferMinutes?: number; minGapMinutes?: number }
  | { kind: 'personalTime'; personalTimeId: string; title: string }
  | { kind: 'outsideAttendance'; date: string }
  | { kind: 'dailyLimit'; date: string; limit: number }
  | { kind: 'beforeEarliestStart'; time: string }
  | { kind: 'fixedEvent'; date: string; title: string };

/** 昼休み（12:00〜13:00）にかかるセッションの警告。除外はしない */
export interface LunchWarning {
  kind: 'lunchOverlap';
  sessionId: string;
  title: string;
  date: string;
  time: string;
}

export interface SelectedSession {
  sessionId: string;
  abbreviation?: string;
  title: string;
  type?: string;
  date?: string;
  time?: string;
  length?: string;
  venue?: string;
  substitutedFor?: string[]; // 指定された回が入らず、再演に差し替えた場合の元の指定ID
}

export interface DroppedCandidate {
  requestedSessionIds: string[];
  title: string;
  options: { sessionId: string; abbreviation?: string; date?: string; time?: string; blockedBy: Blocker[] }[];
}

export interface OptimizeResult {
  reserve: string[]; // schedule_plan の reserve にそのまま渡せる
  selected: SelectedSession[];
  warnings: LunchWarning[]; // lunchBreak 指定時のみ。選んだ回のうち昼休みにかかるもの
  dropped: DroppedCandidate[];
  unknownSessionIds: string[];
  withoutTime: string[]; // 時刻情報が無く配置できない候補
  optimal: boolean;
}

interface Slot {
  session: Session;
  date: string;
  start: number;
  end: number;
  preferred: boolean; // 指定された回か
  preferredType: boolean;
}

interface Group {
  requestedSessionIds: string[];
  title: string;
  allSlots: Slot[];
  options: Slot[]; // 参加日内で、個人予定と重ならない回
}

interface FixedBlock {
  pt: PersonalTime;
  start: number;
  end: number;
}

const DEFAULT_MAX_NODES = 200_000;

function toSlot(session: Session, preferred: boolean, preferredTypes: Set<string>): Slot | undefined {
  const start = sessionStartUtc(session);
  const end = sessionEndUtc(session);
  const date = session.sessionTime?.date;
  if (!start || !end || !date) return undefined;
  return {
    session,
    date,
    start: start.getTime(),
    end: end.getTime(),
    preferred,
    preferredType: session.type !== undefined && preferredTypes.has(session.type.toLowerCase()),
  };
}

/** 重なり、または移動時間・最低空き時間が足りない場合にBlockerを返す */
function slotBlocker(a: Slot, b: Slot, considerTravelTime: boolean, minGapMinutes: number): Blocker | undefined {
  const base = { kind: 'session' as const, sessionId: b.session.sessionId, title: b.session.title };
  if (a.start < b.end && b.start < a.end) return base;
  const [first, second] = a.end <= b.start ? [a, b] : [b, a];
  const gap = second.start - first.end;
  const travel = considerTravelTime && first.session.venue && second.session.venue
    ? getTravelMinutes(first.session.venue, second.session.venue)
    : 0;
  // 席は開始の10分前までに着かないと譲られるので、移動時間に到着の余裕を足す（移動時間を考慮するときだけ）
  const arrival = considerTravelTime ? ARRIVAL_BUFFER_MINUTES : 0;
  if (gap >= Math.max(travel + arrival, minGapMinutes) * 60_000) return undefined;
  return {
    ...base,
    ...(gap < (travel + arrival) * 60_000 ? { requiredTravelMinutes: travel, ...(arrival > 0 ? { arrivalBufferMinutes: arrival } : {}) } : {}),
    ...(gap < minGapMinutes * 60_000 ? { minGapMinutes } : {}),
  };
}

const LUNCH_START_MINUTES = 12 * 60;
const LUNCH_END_MINUTES = 13 * 60;

const minutesOfDay = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 昼休み（12:00〜13:00、会場現地）にかかるセッションを日時順に返す。ちょうど12:00終了・13:00開始はかからない */
export function lunchOverlapWarnings(sessions: Session[]): LunchWarning[] {
  return sessions
    .flatMap((s): LunchWarning[] => {
      const { date, time, length } = s.sessionTime ?? {};
      if (!date || !time) return [];
      const start = minutesOfDay(time);
      const end = start + (Number(length) || 0);
      return start < LUNCH_END_MINUTES && LUNCH_START_MINUTES < end
        ? [{ kind: 'lunchOverlap', sessionId: s.sessionId, title: s.title, date, time }]
        : [];
    })
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function fixedBlockers(slot: Slot, blocks: FixedBlock[], options: OptimizeOptions): Blocker[] {
  const { dateRange, earliestStart, fixedEvents } = options;
  const blockers: Blocker[] = [];
  if ((dateRange?.firstDay && slot.date < dateRange.firstDay) || (dateRange?.lastDay && slot.date > dateRange.lastDay)) {
    blockers.push({ kind: 'outsideAttendance', date: slot.date });
  }
  for (const b of blocks) {
    if (slot.start < b.end && b.start < slot.end) blockers.push({ kind: 'personalTime', personalTimeId: b.pt.personalTimeId, title: b.pt.title });
  }

  // 会場現地の時刻（sessionTime.time は会場現地の "HH:MM"）。UTC換算せずに分で比べる
  const localStart = minutesOfDay(slot.session.sessionTime?.time ?? '00:00');
  const localEnd = localStart + (slot.end - slot.start) / 60_000;
  if (earliestStart && localStart < minutesOfDay(earliestStart)) blockers.push({ kind: 'beforeEarliestStart', time: earliestStart });
  for (const e of fixedEvents ?? []) {
    if (e.date === slot.date && localStart < minutesOfDay(e.end) && minutesOfDay(e.start) < localEnd) {
      blockers.push({ kind: 'fixedEvent', date: e.date, title: e.title });
    }
  }
  return blockers;
}

function toSelected(slot: Slot, group: Group): SelectedSession {
  const s = slot.session;
  return {
    sessionId: s.sessionId,
    abbreviation: s.abbreviation,
    title: s.title,
    type: s.type,
    date: s.sessionTime?.date,
    time: s.sessionTime?.time,
    length: s.sessionTime?.length,
    venue: s.venue,
    ...(slot.preferred ? {} : { substitutedFor: group.requestedSessionIds }),
  };
}

export function optimizeSchedule(
  candidateIds: string[],
  allSessions: Session[],
  personalTimes: PersonalTime[],
  options: OptimizeOptions = {},
): OptimizeResult {
  const considerTravelTime = options.considerTravelTime ?? true;
  const minGapMinutes = options.minGapMinutes ?? 0;
  const maxPerDay = options.maxSessionsPerDay ?? Infinity;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const preferredTypes = new Set((options.preferredTypes ?? []).map((t) => t.toLowerCase()));
  const byId = new Map(allSessions.map((s) => [s.sessionId, s]));
  const unknownSessionIds: string[] = [];
  const withoutTime: string[] = [];

  // 同じ元番号（-R/-R1…）の候補は1つのグループにまとめる
  const requestedByKey = new Map<string, Session[]>();
  for (const id of new Set(candidateIds)) {
    const session = byId.get(id);
    if (!session) {
      unknownSessionIds.push(id);
      continue;
    }
    const key = session.abbreviation ? baseAbbreviation(session.abbreviation) : session.sessionId;
    requestedByKey.set(key, [...(requestedByKey.get(key) ?? []), session]);
  }

  const blocks: FixedBlock[] = [];
  for (const pt of blockingPersonalTimes(personalTimes)) {
    const range = personalTimeRangeUtc(pt);
    if (range) blocks.push({ pt, start: range.start.getTime(), end: range.end.getTime() });
  }

  const groups: Group[] = [];
  for (const [key, requested] of requestedByKey) {
    const requestedIds = new Set(requested.map((s) => s.sessionId));
    const instances = requested[0].abbreviation
      ? allSessions.filter((s) => s.abbreviation !== undefined && baseAbbreviation(s.abbreviation) === key)
      : requested;
    const allSlots = instances
      .map((s) => toSlot(s, requestedIds.has(s.sessionId), preferredTypes))
      .filter((s): s is Slot => Boolean(s))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.start - b.start);
    if (allSlots.length === 0) {
      withoutTime.push(...requestedIds);
      continue;
    }
    groups.push({
      requestedSessionIds: [...requestedIds],
      title: requested[0].title,
      allSlots,
      options: allSlots.filter((slot) => fixedBlockers(slot, blocks, options).length === 0),
    });
  }

  // 選択肢が少ないグループから決めると枝刈りが効きやすい
  const ordered = [...groups].sort((a, b) => a.options.length - b.options.length || (a.options[0]?.start ?? 0) - (b.options[0]?.start ?? 0));
  const n = ordered.length;
  const assignment: (Slot | null)[] = new Array(n).fill(null);
  const chosen: Slot[] = [];
  const perDay = new Map<string, number>();
  let best = { assignment: [...assignment], count: -1, preferredTypeCount: -1, substitutions: Infinity };
  let nodes = 0;
  let aborted = false;

  const compatible = (slot: Slot) =>
    (perDay.get(slot.date) ?? 0) < maxPerDay && chosen.every((c) => !slotBlocker(slot, c, considerTravelTime, minGapMinutes));

  const search = (i: number, count: number, preferredTypeCount: number, substitutions: number): void => {
    if (aborted) return;
    if (++nodes > maxNodes) {
      aborted = true;
      return;
    }
    if (i === n) {
      const better = count > best.count
        || (count === best.count && preferredTypeCount > best.preferredTypeCount)
        || (count === best.count && preferredTypeCount === best.preferredTypeCount && substitutions < best.substitutions);
      if (better) best = { assignment: [...assignment], count, preferredTypeCount, substitutions };
      return;
    }

    let countBound = count;
    let preferredTypeBound = preferredTypeCount;
    for (let j = i; j < n; j += 1) {
      const fits = ordered[j].options.filter(compatible);
      if (fits.length === 0) continue;
      countBound += 1;
      if (fits.some((s) => s.preferredType)) preferredTypeBound += 1;
    }
    if (countBound < best.count) return;
    if (countBound === best.count) {
      if (preferredTypeBound < best.preferredTypeCount) return;
      if (preferredTypeBound === best.preferredTypeCount && substitutions >= best.substitutions) return;
    }

    for (const slot of ordered[i].options) {
      if (!compatible(slot)) continue;
      chosen.push(slot);
      perDay.set(slot.date, (perDay.get(slot.date) ?? 0) + 1);
      assignment[i] = slot;
      search(i + 1, count + 1, preferredTypeCount + (slot.preferredType ? 1 : 0), substitutions + (slot.preferred ? 0 : 1));
      perDay.set(slot.date, (perDay.get(slot.date) ?? 1) - 1);
      chosen.pop();
    }
    assignment[i] = null;
    search(i + 1, count, preferredTypeCount, substitutions);
  };
  search(0, 0, 0, 0);

  const selectedSlots = best.assignment.filter((s): s is Slot => Boolean(s));
  const selectedPerDay = new Map<string, number>();
  for (const s of selectedSlots) selectedPerDay.set(s.date, (selectedPerDay.get(s.date) ?? 0) + 1);

  const selected = ordered
    .map((group, i) => ({ group, slot: best.assignment[i] }))
    .filter((x): x is { group: Group; slot: Slot } => Boolean(x.slot))
    .sort((a, b) => a.slot.start - b.slot.start)
    .map(({ group, slot }) => toSelected(slot, group));

  const dropped: DroppedCandidate[] = ordered
    .filter((_, i) => !best.assignment[i])
    .map((group) => ({
      requestedSessionIds: group.requestedSessionIds,
      title: group.title,
      options: group.allSlots.map((slot) => ({
        sessionId: slot.session.sessionId,
        abbreviation: slot.session.abbreviation,
        date: slot.session.sessionTime?.date,
        time: slot.session.sessionTime?.time,
        blockedBy: [
          ...fixedBlockers(slot, blocks, options),
          ...((selectedPerDay.get(slot.date) ?? 0) >= maxPerDay ? [{ kind: 'dailyLimit' as const, date: slot.date, limit: maxPerDay }] : []),
          ...selectedSlots.map((c) => slotBlocker(slot, c, considerTravelTime, minGapMinutes)).filter((b): b is Blocker => Boolean(b)),
        ],
      })),
    }));

  return {
    reserve: selected.map((s) => s.sessionId),
    selected,
    warnings: options.lunchBreak ? lunchOverlapWarnings(selectedSlots.map((s) => s.session)) : [],
    dropped,
    unknownSessionIds,
    withoutTime,
    optimal: !aborted,
  };
}

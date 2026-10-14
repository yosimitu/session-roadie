import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SeatAvailability, Session } from '../api/types.js';
import { listSnapshotDates, loadSnapshotByDate } from './store.js';

/** ある日に観測した、セッションごとの空席表示 */
export interface SeatObservation {
  date: string; // "YYYY-MM-DD"（UTC基準。スナップショットの日付と同じ）
  seats: Record<string, SeatAvailability>;
}

type HistoryFile = Record<string, Record<string, SeatAvailability>>;

function historyPath(eventId: string, dir: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(eventId)) throw new Error(`eventId は英数字・ハイフン・アンダースコアのみ使えます: "${eventId}"`);
  return join(dir, `seat-history-${eventId}.json`);
}

const today = (): string => new Date().toISOString().slice(0, 10);

function seatsOf(sessions: Session[]): Record<string, SeatAvailability> {
  const seats: Record<string, SeatAvailability> = {};
  for (const s of sessions) if (s.seatAvailability) seats[s.sessionId] = s.seatAvailability;
  return seats;
}

function readHistoryFile(eventId: string, dir: string): HistoryFile {
  const path = historyPath(eventId, dir);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as HistoryFile) : {};
  } catch {
    return {};
  }
}

/**
 * 今日の空席表示を履歴に記録する（同じ日に複数回記録したら、その日の最新で上書き）。
 * 空席表示を持つセッションが1件もないときは何も書かない。
 */
export function recordSeatHistory(eventId: string, sessions: Session[], dir: string, date: string = today()): void {
  const seats = seatsOf(sessions);
  if (Object.keys(seats).length === 0) return;
  mkdirSync(dir, { recursive: true });
  const history = readHistoryFile(eventId, dir);
  history[date] = seats;
  writeFileSync(historyPath(eventId, dir), JSON.stringify(history));
}

/**
 * 空席表示の履歴を、日付の古い順に返す。履歴ファイルと、日付別のカタログのスナップショット
 * （sync が毎回保存する）をまとめる。同じ日付は履歴ファイルを優先する。
 * 空席表示を持たない古いスナップショット（2026-10-06 以前）は含まれない。
 */
export function loadSeatHistory(eventId: string, dir: string): SeatObservation[] {
  const byDate = new Map<string, Record<string, SeatAvailability>>();
  for (const date of listSnapshotDates(eventId, dir)) {
    const sessions = loadSnapshotByDate(eventId, dir, date);
    const seats = sessions ? seatsOf(sessions) : {};
    if (Object.keys(seats).length > 0) byDate.set(date, seats);
  }
  for (const [date, seats] of Object.entries(readHistoryFile(eventId, dir))) byDate.set(date, seats);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, seats]) => ({ date, seats }));
}

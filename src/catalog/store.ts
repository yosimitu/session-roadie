import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../api/types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function snapshotPath(eventId: string, dir: string): string {
  return join(dir, `catalog-${eventId}.json`);
}

function dailySnapshotPrefix(eventId: string): string {
  return `catalog-${eventId}-`;
}

function dailySnapshotPath(eventId: string, dir: string, date: string): string {
  return join(dir, `${dailySnapshotPrefix(eventId)}${date}.json`);
}

/** UTC基準の "YYYY-MM-DD" */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * スナップショットを保存する。「最新」として1本（loadSnapshotで読む）に加えて、
 * 日付ごとの履歴としても保存する（省略時は今日の日付。loadSnapshotByDate/listSnapshotDatesで
 * 任意の過去日と比較できるようにするための記録。同じ日に複数回保存した場合はその日の最新で上書き）。
 */
export function saveSnapshot(eventId: string, sessions: Session[], dir: string, date: string = todayDateString()): void {
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(sessions);
  writeFileSync(snapshotPath(eventId, dir), json);
  writeFileSync(dailySnapshotPath(eventId, dir, date), json);
}

export function loadSnapshot(eventId: string, dir: string): Session[] | undefined {
  const path = snapshotPath(eventId, dir);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as Session[];
}

/** 指定日（YYYY-MM-DD）のスナップショットを読み込む。保存されていなければundefined。 */
export function loadSnapshotByDate(eventId: string, dir: string, date: string): Session[] | undefined {
  const path = dailySnapshotPath(eventId, dir, date);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as Session[];
}

/** 保存済みの日付別スナップショットの日付一覧を新しい順で返す（「いつと比較できるか」をユーザーに示す用） */
export function listSnapshotDates(eventId: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  const prefix = dailySnapshotPrefix(eventId);
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => f.slice(prefix.length, -'.json'.length))
    .filter((d) => DATE_PATTERN.test(d))
    .sort()
    .reverse();
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApiClient } from '../api/client.js';
import type { Session } from '../api/types.js';
import { buildIcs } from '../reporting/ics.js';
import { runScheduleStatus } from './scheduleStatus.js';

export interface ScheduleIcsOptions {
  snapshot: Session[];
  outPath: string;
  favorites?: boolean;
  now?: Date;
}

export interface ScheduleIcsResult {
  path: string;
  events: number;
  skipped: string[];
}

/** 現在のスケジュールを取得して、カレンダーに取り込める .ics に書き出す（予定は変更しない） */
export async function runScheduleIcs(client: ApiClient, eventId: string, options: ScheduleIcsOptions): Promise<ScheduleIcsResult> {
  const schedule = await runScheduleStatus(client, eventId);
  const ics = buildIcs(schedule, options.snapshot, { favorites: options.favorites, now: options.now });
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, ics.text, 'utf-8');
  return { path: options.outPath, events: ics.events, skipped: ics.skipped };
}

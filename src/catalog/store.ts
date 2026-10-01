import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../api/types.js';

function snapshotPath(eventId: string, dir: string): string {
  return join(dir, `catalog-${eventId}.json`);
}

export function saveSnapshot(eventId: string, sessions: Session[], dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(snapshotPath(eventId, dir), JSON.stringify(sessions));
}

export function loadSnapshot(eventId: string, dir: string): Session[] | undefined {
  const path = snapshotPath(eventId, dir);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as Session[];
}

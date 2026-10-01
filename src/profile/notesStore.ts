import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';

export type NotesBySessionId = Record<string, string>;

export function loadNotes(path: string): NotesBySessionId {
  if (!existsSync(path)) return {};
  try {
    const parsed = parse(readFileSync(path, 'utf-8')) as NotesBySessionId;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function saveNotes(path: string, notes: NotesBySessionId): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(notes), 'utf-8');
}

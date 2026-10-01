import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

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

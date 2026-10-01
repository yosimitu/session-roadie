import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNotes, saveNotes } from '../../src/profile/notesStore.js';

describe('notesStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-notes-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('ファイルが無ければ空オブジェクトを返す（メモは任意）', () => {
    expect(loadNotes(join(dir, 'missing.yaml'))).toEqual({});
  });

  it('保存したメモを読み戻せる', () => {
    const path = join(dir, 'notes.yaml');
    saveNotes(path, { s1: '田中さんが絶対見ろと言っていた' });
    expect(loadNotes(path)).toEqual({ s1: '田中さんが絶対見ろと言っていた' });
  });

  it('既存のメモに追記しても他のセッションのメモは保持される', () => {
    const path = join(dir, 'notes.yaml');
    saveNotes(path, { s1: 'メモ1' });
    const notes = loadNotes(path);
    saveNotes(path, { ...notes, s2: 'メモ2' });
    expect(loadNotes(path)).toEqual({ s1: 'メモ1', s2: 'メモ2' });
  });
});

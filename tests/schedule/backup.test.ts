import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveScheduleBackup, hasPlanChanges } from '../../src/schedule/backup.js';

describe('saveScheduleBackup', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'roadie-backup-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('予約とお気に入りを、時刻つきのファイル名で保存する', () => {
    const now = new Date('2026-10-14T01:02:03.456Z');
    const path = saveScheduleBackup('reinvent2026', { reserved: ['r1'], favorites: ['f1', 'f2'], personalTime: [] }, dir, now);

    expect(path).toBe(join(dir, 'schedule-backup-reinvent2026-2026-10-14T010203Z.json'));
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      savedAt: '2026-10-14T01:02:03.456Z',
      eventId: 'reinvent2026',
      reserved: ['r1'],
      favorites: ['f1', 'f2'],
    });
  });

  it('data ディレクトリが無ければ作る', () => {
    const nested = join(dir, 'data');
    const path = saveScheduleBackup('reinvent2026', { reserved: [], favorites: [], personalTime: [] }, nested);
    expect(existsSync(path)).toBe(true);
  });

  it('時刻が違えば別ファイルになる', () => {
    const a = saveScheduleBackup('e', { reserved: [], favorites: [], personalTime: [] }, dir, new Date('2026-10-14T00:00:00Z'));
    const b = saveScheduleBackup('e', { reserved: [], favorites: [], personalTime: [] }, dir, new Date('2026-10-14T00:00:01Z'));
    expect(a).not.toBe(b);
  });
});

describe('hasPlanChanges', () => {
  it('どれか1つでも差分があれば true', () => {
    expect(hasPlanChanges({ toReserve: [], toCancelReservation: [], toFavorite: [], toUnfavorite: ['x'] })).toBe(true);
  });
  it('差分が無ければ false', () => {
    expect(hasPlanChanges({ toReserve: [], toCancelReservation: [], toFavorite: [], toUnfavorite: [] })).toBe(false);
  });
});

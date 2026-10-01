import { describe, it, expect } from 'vitest';
import { diffCatalog } from '../../src/catalog/diff.js';
import type { Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return {
    title: 'Test Session',
    venue: 'Venetian',
    room: 'Lando 4201',
    sessionTime: { date: '2026-12-02', time: '10:00', length: '60', timezone: 'America/Los_Angeles' },
    ...overrides,
  };
}

describe('diffCatalog', () => {
  it('旧スナップショットに無いセッションは新規扱い', () => {
    const before: Session[] = [];
    const after: Session[] = [session({ sessionId: 's1' })];
    const diff = diffCatalog(before, after);
    expect(diff.added.map((s) => s.sessionId)).toEqual(['s1']);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('新しい全件取得に無いセッションはキャンセル扱い', () => {
    const before: Session[] = [session({ sessionId: 's1' })];
    const after: Session[] = [];
    const diff = diffCatalog(before, after);
    expect(diff.removed.map((s) => s.sessionId)).toEqual(['s1']);
    expect(diff.added).toEqual([]);
  });

  it('時間・会場が変わったセッションを変更扱いにする', () => {
    const before: Session[] = [session({ sessionId: 's1', venue: 'Venetian' })];
    const after: Session[] = [session({ sessionId: 's1', venue: 'Wynn' })];
    const diff = diffCatalog(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].sessionId).toBe('s1');
    expect(diff.changed[0].changedFields).toContain('venue');
  });

  it('時間・会場以外の変更（abstractなど）は変更扱いにしない', () => {
    const before: Session[] = [session({ sessionId: 's1', abstract: 'A' })];
    const after: Session[] = [session({ sessionId: 's1', abstract: 'B' })];
    const diff = diffCatalog(before, after);
    expect(diff.changed).toEqual([]);
  });

  it('何も変わっていなければ3つとも空', () => {
    const before: Session[] = [session({ sessionId: 's1' })];
    const after: Session[] = [session({ sessionId: 's1' })];
    const diff = diffCatalog(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

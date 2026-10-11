import { describe, it, expect } from 'vitest';
import { buildNoteReminder } from '../../src/schedule/noteReminder.js';
import type { Session } from '../../src/api/types.js';

describe('buildNoteReminder', () => {
  it('セッション開始15分前から開始時刻までのPersonalTimeInputを作る（企画書 §5.7「当日の表示」）', () => {
    const session: Session = {
      sessionId: 's1', title: 'SVS401',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    };
    const pt = buildNoteReminder(session, '田中さんが絶対見ろと言っていた');

    // 10:00 PST の15分前は9:45（現地時刻のまま書く）
    expect(pt?.startDateTime).toBe('2026-12-02T09:45:00');
    expect(pt?.endDateTime).toBe('2026-12-02T10:00:00');
    expect(pt?.description).toBe('田中さんが絶対見ろと言っていた');
  });

  it('半角角括弧を含むメモはサニタイズする', () => {
    const session: Session = {
      sessionId: 's1', title: 'SVS401',
      sessionTime: { date: '2026-12-02', time: '10:00', length: '60' },
    };
    const pt = buildNoteReminder(session, '[重要] 田中さん推薦');
    expect(pt?.description).toBe('〔重要〕 田中さん推薦');
  });

  it('時刻情報が無いセッションはundefinedを返す', () => {
    const session: Session = { sessionId: 's1', title: 'SVS401' };
    expect(buildNoteReminder(session, 'メモ')).toBeUndefined();
  });
});

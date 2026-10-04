import { describe, it, expect } from 'vitest';
import { findConflicts, findPersonalTimeConflicts } from '../../src/commands/conflicts.js';
import type { PersonalTime, Session } from '../../src/api/types.js';

function personalTime(overrides: Partial<PersonalTime> & { personalTimeId: string; startDateTime: string; endDateTime: string }): PersonalTime {
  return { title: 'Keynote', description: '', ...overrides };
}

describe('findPersonalTimeConflicts', () => {
  // セッションは会場のPST、個人予定はUTC。12/2 08:00-10:00 PST = 16:00-18:00 UTC
  const workshop = { sessionId: 'w', title: 'Workshop', sessionTime: { date: '2026-12-02', time: '08:00', length: '120' } };

  it('PSTのセッションとUTCの個人予定を同じ時間軸で比べて重複を返す', () => {
    const keynote = personalTime({ personalTimeId: 'k', startDateTime: '2026-12-02T16:30:00', endDateTime: '2026-12-02T18:00:00' });
    expect(findPersonalTimeConflicts([workshop], [keynote])).toEqual([
      { sessionId: 'w', personalTimeId: 'k', personalTimeTitle: 'Keynote', startDateTime: '2026-12-02T16:30:00', endDateTime: '2026-12-02T18:00:00' },
    ]);
  });

  it('接しているだけ（終了=開始）なら重複にしない', () => {
    const after = personalTime({ personalTimeId: 'k', startDateTime: '2026-12-02T18:00:00', endDateTime: '2026-12-02T19:00:00' });
    expect(findPersonalTimeConflicts([workshop], [after])).toEqual([]);
  });

  it('re:Roadieが書き込んだ移動時間ブロック・メモのリマインダーは対象外', () => {
    const travel = personalTime({ personalTimeId: 't', title: 'MGM → Venetian 移動', description: '35分の移動時間を確保（概算値・要検証）', startDateTime: '2026-12-02T16:30:00', endDateTime: '2026-12-02T17:00:00' });
    const reminder = personalTime({ personalTimeId: 'r', title: '📝 Workshop', description: 'memo', startDateTime: '2026-12-02T16:45:00', endDateTime: '2026-12-02T17:00:00' });
    expect(findPersonalTimeConflicts([workshop], [travel, reminder])).toEqual([]);
  });
});

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('findConflicts', () => {
  it('同じ日時に重なる予約済みセッションをグループ化する', () => {
    const a = session({ sessionId: 'a', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', sessionTime: { date: '2026-12-02', time: '10:30', length: '60' } });
    const c = session({ sessionId: 'c', sessionTime: { date: '2026-12-02', time: '14:00', length: '60' } });

    const groups = findConflicts([a, b, c]);

    expect(groups).toHaveLength(1);
    expect(groups[0].map((s) => s.sessionId).sort()).toEqual(['a', 'b']);
  });

  it('重ならなければ空配列', () => {
    const a = session({ sessionId: 'a', sessionTime: { date: '2026-12-02', time: '10:00', length: '60' } });
    const b = session({ sessionId: 'b', sessionTime: { date: '2026-12-02', time: '11:00', length: '60' } });
    expect(findConflicts([a, b])).toEqual([]);
  });
});

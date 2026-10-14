import { describe, it, expect } from 'vitest';
import type { PersonalTime, Session } from '../../src/api/types.js';
import { busyIntervalsOf, fitsAround } from '../../src/planning/busyIntervals.js';

// 会場現地 2026-12-02 の時刻から、実際の時刻（UTC）を作る（会場は UTC-8）
const at = (hhmm: string): Date => new Date(`2026-12-02T${hhmm}:00-08:00`);

const reservedSession = (time: string, venue = 'Venetian'): Session => ({
  sessionId: `s${time}`, title: 'T', abbreviation: `S${time}`, venue, sessionTime: { date: '2026-12-02', time, length: '60' },
});
const personal = (from: string, to: string): PersonalTime => ({
  personalTimeId: 'p', title: '会食', description: '', startDateTime: `2026-12-02T${from}:00`, endDateTime: `2026-12-02T${to}:00`,
});

describe('fitsAround', () => {
  // 予約: 12:00-13:00 Venetian
  const busy = busyIntervalsOf([reservedSession('12:00')], []);

  it('予約済みセッションとの間に、開始の10分前に着ける間隔（移動0分の同じ会場でも10分）が要る', () => {
    expect(fitsAround(at('10:00'), at('11:50'), 'Venetian', busy)).toBe(true); // 前: 終了の10分後に開始
    expect(fitsAround(at('10:00'), at('11:51'), 'Venetian', busy)).toBe(false); // 前: 9分
    expect(fitsAround(at('13:10'), at('14:00'), 'Venetian', busy)).toBe(true); // 後: 終了の10分後に開始
    expect(fitsAround(at('13:09'), at('14:00'), 'Venetian', busy)).toBe(false); // 後: 9分
  });

  it('別会場なら、移動時間にさらに10分を足す（Venetian→Wynn 15分なら25分）', () => {
    expect(fitsAround(at('10:00'), at('11:35'), 'Wynn/Encore', busy)).toBe(true); // 空き25分
    expect(fitsAround(at('10:00'), at('11:36'), 'Wynn/Encore', busy)).toBe(false); // 空き24分
  });

  it('個人予定との間には、重ならなければよい（余裕は要らない）', () => {
    const withPersonal = busyIntervalsOf([], [personal('12:00', '13:00')]);
    expect(fitsAround(at('10:00'), at('12:00'), 'Venetian', withPersonal)).toBe(true);
    expect(fitsAround(at('13:00'), at('14:00'), 'Venetian', withPersonal)).toBe(true);
    expect(fitsAround(at('11:00'), at('12:01'), 'Venetian', withPersonal)).toBe(false);
  });

  it('移動時間ブロックなど、予約から派生した個人予定は無視する', () => {
    const block: PersonalTime = { ...personal('12:00', '13:00'), title: 'Venetian → Wynn 移動', description: '15分の移動時間を確保（概算値・要検証）' };
    expect(busyIntervalsOf([], [block])).toEqual([]);
  });
});

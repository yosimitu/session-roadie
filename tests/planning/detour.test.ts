import { describe, it, expect } from 'vitest';
import type { PersonalTime, Session } from '../../src/api/types.js';
import { suggestDetours } from '../../src/planning/detour.js';

function s(id: string, time: string, overrides: Partial<Session> = {}): Session {
  return {
    sessionId: id, title: `Session ${id}`, abbreviation: id.toUpperCase(), type: 'Breakout session',
    venue: 'Venetian', seatAvailability: 'available', topics: ['Other'],
    sessionTime: { date: '2026-12-02', time, length: '60' },
    ...overrides,
  };
}

const sec = (t: string[]) => ({ topics: t });
const base = { personalTimes: [] as PersonalTime[] };

describe('suggestDetours', () => {
  const mine = s('mine', '09:00', sec(['Security & Identity']));

  it('予約のある日について、関心の強さが小さい順に提案する', () => {
    const sessions = [
      mine,
      s('same', '11:00', sec(['Security & Identity'])), // 予約と同じトピック（強さ2）
      s('far', '11:00', sec(['Game Tech'])), // 強さ0
    ];
    const r = suggestDetours({ ...base, sessions, reserved: [mine] });
    expect(r.days).toHaveLength(1);
    expect(r.days[0].date).toBe('2026-12-02');
    expect(r.days[0].candidates.map((c) => [c.sessionId, c.affinity])).toEqual([['far', 0], ['same', 2]]);
    expect(r.days[0].candidates[0].between).toEqual({ before: 'MINE' });
  });

  it('関心の強さは、宣言した関心（3）・予約（2）・お気に入り（1）から数え、複数のトピックでは最大を使う', () => {
    const sessions = [
      mine,
      s('declared', '11:00', sec(['AI'])), // 宣言 → 3
      s('favTopic', '11:15', sec(['Data'])), // お気に入り1件 → 1
      s('fav', '15:00', sec(['Data'])),
      s('mixed', '11:30', sec(['Game Tech', 'AI'])), // 最大の3
      s('far', '12:00', sec(['Game Tech'])), // 0
    ];
    const r = suggestDetours({ ...base, sessions, reserved: [mine], favoriteIds: ['fav'], profile: { interestTopics: ['AI'] }, perDay: 10 });
    const byId = Object.fromEntries(r.days[0].candidates.map((c) => [c.sessionId, c.affinity]));
    expect(byId).toMatchObject({ far: 0, favTopic: 1, declared: 3, mixed: 3 });
    expect(r.days[0].candidates.map((c) => c.sessionId)).not.toContain('fav'); // お気に入り自身は出さない
    expect(r.days[0].candidates.map((c) => c.sessionId).slice(0, 2)).toEqual(['far', 'favTopic']);
  });

  it('予約や個人予定と重なるもの、移動が間に合わないものは除く', () => {
    const next = s('next', '12:00', { ...sec(['Security & Identity']), venue: 'Wynn/Encore' });
    const pt: PersonalTime = {
      personalTimeId: 'p', title: '会食', description: '', startDateTime: '2026-12-02T15:00:00', endDateTime: '2026-12-02T16:00:00',
    };
    const sessions = [
      mine, next,
      s('overlapNext', '12:30', sec(['Game Tech'])),
      s('tight', '10:50', sec(['Game Tech'])), // 11:50 終了。Wynn まで15分取れない（余裕10分）
      s('overlapPt', '15:30', sec(['Game Tech'])),
      s('ok', '10:20', sec(['Game Tech'])), // 11:20 終了、40分の余裕
    ];
    const r = suggestDetours({ personalTimes: [pt], sessions, reserved: [mine, next] });
    expect(r.days[0].candidates.map((c) => c.sessionId)).toEqual(['ok']);
  });

  it('関心の強さが上限（3）を超える、中核の分野のセッションは出さない', () => {
    const reserved = [mine, s('mine2', '14:00', sec(['Security & Identity']))]; // 強さ 2+2=4
    const sessions = [...reserved, s('core', '11:00', sec(['Security & Identity'])), s('far', '11:00', sec(['Game Tech']))];
    const r = suggestDetours({ ...base, sessions, reserved });
    expect(r.days[0].candidates.map((c) => c.sessionId)).toEqual(['far']);
  });

  it('満席は除き、同じ強さなら、空席が多い順・予約と形式が違う順・時刻の早い順に並べる', () => {
    const sessions = [
      mine,
      s('full', '11:00', { ...sec(['Game Tech']), seatAvailability: 'unavailable' }),
      s('limited', '11:00', { ...sec(['Game Tech']), seatAvailability: 'limited' }),
      s('sameType', '11:00', { ...sec(['Robotics']) }),
      s('diffType', '11:00', { ...sec(['Quantum']), type: 'Chalk talk' }),
    ];
    const r = suggestDetours({ ...base, sessions, reserved: [mine] });
    expect(r.days[0].candidates.map((c) => c.sessionId)).toEqual(['diffType', 'sameType', 'limited']);
  });

  it('同じ番号の再演は1つだけ出し、perDay で件数を絞る', () => {
    const sessions = [
      mine,
      s('x1', '11:00', { ...sec(['Game Tech']), abbreviation: 'GAM101' }),
      s('x2', '13:00', { ...sec(['Game Tech']), abbreviation: 'GAM101-R' }),
      s('y', '12:00', { ...sec(['Robotics']) }),
      s('z', '14:00', { ...sec(['Quantum']) }),
    ];
    const r = suggestDetours({ ...base, sessions, reserved: [mine], perDay: 2 });
    expect(r.days[0].candidates.map((c) => c.sessionId)).toEqual(['x1', 'y']);
  });

  it('プロフィールのレベル・スポンサー・開始時刻の条件を守る', () => {
    const sessions = [
      mine,
      s('l400', '11:00', { ...sec(['Game Tech']), level: '400 - Expert' }),
      s('spons', '11:00', { ...sec(['Robotics']), abbreviation: 'ABC1-S' }),
      s('early', '07:30', sec(['Quantum'])),
      s('ok', '11:00', { ...sec(['Space']), level: '200 - Intermediate' }),
    ];
    const r = suggestDetours({ ...base, sessions, reserved: [mine], profile: { maxLevel: 300, excludeSponsored: true, earliestStart: '09:00' } });
    expect(r.days[0].candidates.map((c) => c.sessionId)).toEqual(['ok']);
  });

  it('トピックが無いセッションは、関心の外と判断できないので出さない', () => {
    const sessions = [mine, s('none', '11:00', { topics: [] })];
    const r = suggestDetours({ ...base, sessions, reserved: [mine] });
    expect(r.days[0].candidates).toEqual([]);
    expect(r.notes.join()).toContain('候補がありません');
  });

  it('日付を指定でき、予約が1件もなく日付の指定もないときは注記する', () => {
    const sessions = [s('far', '11:00', sec(['Game Tech']))];
    expect(suggestDetours({ ...base, sessions, reserved: [], dates: ['2026-12-02'] }).days[0].candidates.map((c) => c.sessionId)).toEqual(['far']);
    const none = suggestDetours({ ...base, sessions, reserved: [] });
    expect(none.days).toEqual([]);
    expect(none.notes.join()).toContain('予約のある日がない');
  });
});

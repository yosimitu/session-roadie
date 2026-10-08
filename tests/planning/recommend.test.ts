import { describe, it, expect } from 'vitest';
import { recommendSessions, RECOMMEND_THRESHOLD, type RecommendInput } from '../../src/planning/recommend.js';
import type { Session } from '../../src/api/types.js';
import type { Profile } from '../../src/profile/profileStore.js';

function s(id: string, topics: string[], extra: Partial<Session> & { date?: string; time?: string; length?: string } = {}): Session {
  const { date = '2026-12-01', time = '10:00', length = '60', ...rest } = extra;
  return {
    sessionId: id, abbreviation: id.toUpperCase(), title: `T-${id}`, type: 'Breakout session', level: '300 – Advanced',
    venue: 'MGM Grand', seatAvailability: 'available', topics, sessionTime: { date, time, length }, ...rest,
  };
}

function run(sessions: Session[], overrides: Partial<RecommendInput> = {}) {
  return recommendSessions({ sessions, reservedIds: [], favoriteIds: [], busy: [], ...overrides });
}

const SEC = 'Security & Identity';
const ANA = 'Analytics';

describe('recommendSessions: トピックの重み', () => {
  it('お気に入りのトピックの出現回数を基本の重みにする（最多を1、他は比例）', () => {
    const fav = [s('f1', [SEC]), s('f2', [SEC]), s('f3', [ANA])];
    const { recipe, byId } = run([...fav, s('c1', [SEC]), s('c2', [ANA]), s('c3', ['Compute'])], { favoriteIds: ['f1', 'f2', 'f3'] });

    expect(recipe).toEqual([
      { topic: SEC, weight: 1, source: 'favorites' },
      { topic: ANA, weight: 0.5, source: 'favorites' },
    ]);
    expect(byId.get('c1')!.score).toBeGreaterThan(byId.get('c2')!.score);
    expect(byId.has('c3')).toBe(false); // 重みの無いトピックだけのセッションは、おすすめにしない
  });

  it('関心トピック（プロフィール）は、お気に入りが無くても0.5の重みを持つ', () => {
    const { recipe } = run([s('c1', ['Databases'])], { profile: { interestTopics: ['Databases'] } });
    expect(recipe).toEqual([{ topic: 'Databases', weight: 0.5, source: 'interest' }]);
  });

  it('優先順位を指定したら、お気に入りの傾向より優先して重みを上書きする（1位=1、最下位=0.5、間は等間隔）', () => {
    const profile: Profile = {
      interestTopics: ['Artificial Intelligence', 'Business Agents', SEC, 'Migration & Modernization', 'Cloud Operations'],
      themePriority: ['セキュリティ', 'Agentic AI・生成AI', '移行・運用'],
    };
    // お気に入りは AI に偏っているが、優先順位ではセキュリティが1位
    const favorites = [s('f1', ['Artificial Intelligence']), s('f2', ['Artificial Intelligence']), s('f3', ['Artificial Intelligence'])];
    const { recipe } = run(favorites, { favoriteIds: ['f1', 'f2', 'f3'], profile });

    const w = (topic: string) => recipe.find((r) => r.topic === topic);
    expect(w(SEC)).toEqual({ topic: SEC, weight: 1, source: 'priority', rank: 1 });
    expect(w('Artificial Intelligence')).toEqual({ topic: 'Artificial Intelligence', weight: 0.75, source: 'priority', rank: 2 });
    expect(w('Business Agents')?.weight).toBe(0.75);
    expect(w('Migration & Modernization')).toEqual({ topic: 'Migration & Modernization', weight: 0.5, source: 'priority', rank: 3 });
    expect(w('Cloud Operations')?.weight).toBe(0.5);
  });

  it('優先順位に入っていない関心トピックは、お気に入りの傾向（無ければ0.5）のまま', () => {
    const profile: Profile = { interestTopics: [SEC, 'Databases'], themePriority: ['セキュリティ'] };
    const { recipe } = run([], { profile });
    expect(recipe.find((r) => r.topic === SEC)?.source).toBe('priority');
    expect(recipe.find((r) => r.topic === 'Databases')).toEqual({ topic: 'Databases', weight: 0.5, source: 'interest' });
  });

  it('レシピは重みの大きい順に並べる', () => {
    const { recipe } = run([s('f1', [ANA]), s('f2', [SEC]), s('f3', [SEC])], { favoriteIds: ['f1', 'f2', 'f3'] });
    expect(recipe.map((r) => r.topic)).toEqual([SEC, ANA]);
  });
});

describe('recommendSessions: スコアと理由', () => {
  const profile: Profile = { purpose: 'learning', interestTopics: [SEC] };

  it('トピック(最大40)・形式(10)・空席(10)・予定に収まる(15)・新着(5)の合計を、80点満点から100点満点にして返す', () => {
    const perfect = s('p', [SEC], { type: 'Workshop' });
    // 重み1にするため、優先順位1位にする
    const prof: Profile = { ...profile, mainTheme: ['セキュリティ'], themePriority: ['セキュリティ'] };
    const r = run([perfect], { profile: prof, newIds: new Set(['p']) }).byId.get('p')!;
    expect(r.score).toBe(100);
    expect(r.reasons).toEqual(expect.arrayContaining(['優先1位: ' + 'セキュリティ & アイデンティティ', '形式: ワークショップ', '空席あり', '予定に収まる', '新着']));
  });

  it('形式の優先（目的が学習ならWorkshopなど）・空席・新着が無い分だけ点が下がる', () => {
    const prof: Profile = { ...profile, themePriority: ['セキュリティ'], mainTheme: ['セキュリティ'] };
    const noType = run([s('a', [SEC])], { profile: prof }).byId.get('a')!;
    expect(noType.score).toBe(Math.round(((40 + 10 + 15) / 80) * 100)); // 形式なし・新着なし
    const veryLimited = run([s('b', [SEC], { seatAvailability: 'veryLimited' })], { profile: prof }).byId.get('b')!;
    expect(veryLimited.reasons).toContain('残りわずか');
    expect(veryLimited.score).toBe(Math.round(((40 + 5 + 15) / 80) * 100));
  });

  it('お気に入りの傾向・関心から来たトピックの理由は、出どころを書く', () => {
    const fav = [s('f1', [ANA])];
    const r = run([...fav, s('c', [ANA])], { favoriteIds: ['f1'] }).byId.get('c')!;
    expect(r.reasons.some((x) => x.startsWith('お気に入りの傾向: '))).toBe(true);
    const r2 = run([s('d', ['Databases'])], { profile: { interestTopics: ['Databases'] } }).byId.get('d')!;
    expect(r2.reasons.some((x) => x.startsWith('関心: '))).toBe(true);
  });

  it('おすすめの閾値は60点', () => {
    expect(RECOMMEND_THRESHOLD).toBe(60);
  });
});

describe('recommendSessions: おすすめにしない条件', () => {
  const profile: Profile = { interestTopics: [SEC] };
  const rec = (sessions: Session[], overrides: Partial<RecommendInput> = {}) => run(sessions, { profile, ...overrides }).byId;

  it('予約済みのセッションは、おすすめにしない', () => {
    expect(rec([s('a', [SEC])], { reservedIds: ['a'] }).has('a')).toBe(false);
  });

  it('満席は、おすすめにしない', () => {
    expect(rec([s('a', [SEC], { seatAvailability: 'unavailable' })]).has('a')).toBe(false);
  });

  it('予約済みと時間が重なるものは、おすすめにしない', () => {
    const reserved = s('r', ['Compute'], { time: '10:00' });
    const map = rec([reserved, s('a', [SEC], { time: '10:30' }), s('b', [SEC], { time: '12:00' })], { reservedIds: ['r'] });
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(true);
  });

  it('予約済みとの間に、移動時間（MGM→Wynn/Encore 30分）が足りないものは、おすすめにしない', () => {
    const reserved = s('r', ['Compute'], { time: '10:00', venue: 'MGM Grand' }); // 10:00-11:00
    const map = rec([
      reserved,
      s('tight', [SEC], { time: '11:10', venue: 'Wynn/Encore' }), // 空き10分 < 30分
      s('ok', [SEC], { time: '11:40', venue: 'Wynn/Encore' }), // 空き40分
      s('same', [SEC], { time: '11:00', venue: 'MGM Grand' }), // 同じ会場なら続けて入れる
    ], { reservedIds: ['r'] });
    expect(map.has('tight')).toBe(false);
    expect(map.has('ok')).toBe(true);
    expect(map.has('same')).toBe(true);
  });

  it('体力から決まる、セッション間の最低空き時間を満たさないものは、おすすめにしない', () => {
    const reserved = s('r', ['Compute'], { time: '10:00' }); // 10:00-11:00
    const map = rec([reserved, s('a', [SEC], { time: '11:10' }), s('b', [SEC], { time: '11:30' })], {
      reservedIds: ['r'], profile: { interestTopics: [SEC], stamina: 'relaxed' }, // 最低30分
    });
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(true);
  });

  it('1日の上限本数に達している日の候補は、おすすめにしない', () => {
    const reserved = ['r1', 'r2', 'r3'].map((id, i) => s(id, ['Compute'], { time: ['08:00', '10:00', '12:00'][i] }));
    const map = rec([...reserved, s('a', [SEC], { time: '16:00' }), s('b', [SEC], { time: '16:00', date: '2026-12-02' })], {
      reservedIds: ['r1', 'r2', 'r3'], profile: { interestTopics: [SEC], stamina: 'relaxed' }, // 1日3本
    });
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(true);
  });

  it('個人予定（基調講演など）・固定の予定と重なるものは、おすすめにしない', () => {
    const map = rec([s('a', [SEC], { time: '09:00' }), s('b', [SEC], { time: '17:00' }), s('c', [SEC], { time: '13:00' })], {
      busy: [{ date: '2026-12-01', start: 8 * 60 + 30, end: 10 * 60 }],
      profile: { interestTopics: [SEC], fixedEvents: [{ date: '2026-12-01', start: '17:30', end: '19:00', title: '会食' }] },
    });
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(true);
  });

  it('参加日の外・希望レベル超え・スポンサー除外・開始時刻より前のものは、おすすめにしない', () => {
    const prof: Profile = {
      interestTopics: [SEC], attendance: { firstDay: '2026-12-01', lastDay: '2026-12-03' },
      maxLevel: 300, excludeSponsored: true, earliestStart: '09:00',
    };
    const map = rec([
      s('out', [SEC], { date: '2026-12-04' }),
      s('hard', [SEC], { level: '400 – Expert' }),
      s('spons', [SEC], { abbreviation: 'SEC227-S' }),
      s('early', [SEC], { time: '08:00' }),
      s('ok', [SEC]),
    ], { profile: prof });
    expect([...map.keys()]).toEqual(['ok']);
  });

  it('ウォークアップ（当日先着）はおすすめにしない（予約できないため）', () => {
    expect(rec([s('w', [SEC], { seatAvailability: 'walkUp' })]).has('w')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import type { Session } from '../../src/api/types.js';
import { computeTrends, titleTerms } from '../../src/planning/trends.js';

let n = 0;
function s(title: string, overrides: Partial<Session> = {}): Session {
  n += 1;
  return { sessionId: `id${n}`, title, topics: [], services: [], type: 'Breakout session', level: '300 – Advanced', ...overrides };
}

describe('titleTerms', () => {
  it('小文字にし、重複・数字だけ・1文字・除外語を捨てる', () => {
    expect(titleTerms('Build AgentCore agents with the AWS Kiro: 2026 AI AI')).toEqual(['agentcore', 'agents', 'kiro', 'ai']);
  });
});

describe('computeTrends', () => {
  it('件数と割合を、多い順に数える（同じセッション内の重複は1回）', () => {
    const current = [
      s('a', { topics: ['AI', 'AI', 'Security'], services: ['Bedrock'] }),
      s('b', { topics: ['AI'], services: ['Bedrock', 'Lambda'] }),
      s('c', { topics: ['Security'], services: ['Lambda'], type: 'Workshop' }),
      s('d', { topics: ['AI'] }),
    ];
    const r = computeTrends({ current });
    expect(r.total).toBe(4);
    expect(r.topics.map((t) => [t.name, t.count, t.share])).toEqual([['AI', 3, 0.75], ['Security', 2, 0.5]]);
    expect(r.services.map((t) => [t.name, t.count])).toEqual([['Bedrock', 2], ['Lambda', 2]]);
    expect(r.types.map((t) => t.name)).toEqual(['Breakout session', 'Workshop']);
    expect(r.topics[0].delta).toBeUndefined();
    expect(r.notes.join()).toContain('比べる過去のスナップショットがない');
  });

  it('基準日があれば、増減と、増えたサービス・語・出入りを出す', () => {
    const base = [s('Intro to Kiro', { services: ['Kiro'] }), s('Old talk', { services: ['EC2'] })];
    const current = [
      ...base,
      ...Array.from({ length: 5 }, (_, i) => s(`Kiro workshop ${i}`, { services: ['Kiro'], topics: ['Developer Tools'] })),
      s('EC2 deep dive', { services: ['EC2'] }),
    ];
    const r = computeTrends({ current, baseline: base, baselineDate: '2026-10-01' });
    expect(r.baselineDate).toBe('2026-10-01');
    expect(r.baselineTotal).toBe(2);
    expect(r.added).toBe(6);
    expect(r.removed).toBe(0);
    const kiro = r.services.find((c) => c.name === 'Kiro')!;
    expect(kiro).toMatchObject({ count: 6, baselineCount: 1, delta: 5 });
    expect(r.risingServices.map((c) => c.name)).toEqual(['Kiro', 'EC2']);
    // 語は、現在5件以上のタイトルに出るものだけ。"kiro" は6件、"workshop" は5件
    expect(r.risingTerms.map((c) => [c.name, c.delta])).toEqual([['kiro', 5], ['workshop', 5]]);
  });

  it('消えたセッションを removed に数え、増えていないものは rising に入れない', () => {
    const base = [s('Gone'), s('Stay')];
    const stay = base[1];
    const r = computeTrends({ current: [stay], baseline: base });
    expect(r.added).toBe(0);
    expect(r.removed).toBe(1);
    expect(r.risingServices).toEqual([]);
  });

  it('指定した語をタイトルで数える（大文字小文字を区別しない）', () => {
    const current = [s('AgentCore Memory'), s('agentcore runtime'), s('Other')];
    const base = [s('AgentCore Memory')];
    const r = computeTrends({ current, baseline: base, keywords: ['AgentCore', 'nothing'] });
    expect(r.keywords.map((k) => [k.name, k.count, k.baselineCount, k.delta])).toEqual([['AgentCore', 2, 1, 1], ['nothing', 0, 0, 0]]);
  });

  it('レベルは表記の違い（ハイフンと en ダッシュ）に関わらず、先頭の3桁で数える', () => {
    const base = [s('a', { level: '300 - Advanced' }), s('b', { level: '200 - Intermediate' }), s('c', { level: undefined })];
    const current = [s('a', { level: '300 – Advanced' }), s('b', { level: '300 – Advanced' }), s('c', { level: '200 – Intermediate' }), s('d', { level: 'No Level' })];
    const r = computeTrends({ current, baseline: base });
    expect(r.levels.map((l) => [l.name, l.count, l.delta])).toEqual([['200', 1, 0], ['300', 2, 1], ['No Level', 1, 0]]);
  });

  it('日別は日付順に並べる', () => {
    const current = [
      s('a', { sessionTime: { date: '2026-12-02' } }),
      s('b', { sessionTime: { date: '2026-11-30' } }),
      s('c', { sessionTime: { date: '2026-11-30' } }),
    ];
    expect(computeTrends({ current }).days.map((d) => [d.name, d.count])).toEqual([['2026-11-30', 2], ['2026-12-02', 1]]);
  });

  it('予約・お気に入りと全体を比べ、多いトピックと少ないトピックを出す', () => {
    const current = [
      ...Array.from({ length: 5 }, () => s('x', { topics: ['AI'] })),
      ...Array.from({ length: 4 }, () => s('y', { topics: ['Security'] })),
      ...Array.from({ length: 1 }, () => s('z', { topics: ['Tiny'] })), // 全体の10% → 比較に入る
    ];
    const mine = current.filter((c) => c.topics?.[0] === 'Security').slice(0, 2); // 自分は Security 100%
    const r = computeTrends({ current, mine });
    expect(r.personal?.over.map((p) => p.name)).toEqual(['Security']);
    expect(r.personal?.over[0].mineShare).toBe(1);
    expect(r.personal?.under.map((p) => p.name)).toEqual(['AI', 'Tiny']);
  });

  it('全体の3%未満のトピックは、自分との比較に入れない', () => {
    const current = [...Array.from({ length: 49 }, () => s('x', { topics: ['AI'] })), s('t', { topics: ['Rare'] })];
    const r = computeTrends({ current, mine: [current[0]] });
    expect([...(r.personal?.over ?? []), ...(r.personal?.under ?? [])].map((p) => p.name)).not.toContain('Rare');
  });

  it('limit で上位だけに絞る', () => {
    const current = ['A', 'B', 'C'].map((t) => s('x', { topics: [t] }));
    expect(computeTrends({ current, limit: 2 }).topics).toHaveLength(2);
  });
});

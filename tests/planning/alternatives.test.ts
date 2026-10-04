import { describe, it, expect } from 'vitest';
import { findRepeat, findSimilarSessions, recommendForConflict } from '../../src/planning/alternatives.js';
import type { Session } from '../../src/api/types.js';

function session(overrides: Partial<Session> & { sessionId: string }): Session {
  return { title: 'Test', ...overrides };
}

describe('findRepeat', () => {
  it('abbreviationの番号が一致し、末尾"-R"が付くセッションを再演として見つける', () => {
    const target = session({ sessionId: 's1', abbreviation: 'DAT205' });
    const repeat = session({ sessionId: 's2', abbreviation: 'DAT205-R' });
    const other = session({ sessionId: 's3', abbreviation: 'CMP318' });

    expect(findRepeat([target, repeat, other], target)?.sessionId).toBe('s2');
  });

  it('"-R"から"-R1"を、"-R1"から"-R"を相互に見つける（元番号が無い組）', () => {
    const r = session({ sessionId: 'r', abbreviation: 'DAT410-R' });
    const r1 = session({ sessionId: 'r1', abbreviation: 'DAT410-R1' });
    const other = session({ sessionId: 'x', abbreviation: 'DAT4101-R' });

    expect(findRepeat([r, r1, other], r)?.sessionId).toBe('r1');
    expect(findRepeat([r, r1, other], r1)?.sessionId).toBe('r');
  });

  it('"-R"から元番号のセッションも見つける', () => {
    const original = session({ sessionId: 'o', abbreviation: 'DAT205' });
    const r = session({ sessionId: 'r', abbreviation: 'DAT205-R' });
    expect(findRepeat([original, r], r)?.sessionId).toBe('o');
  });

  it('再演が無ければundefinedを返す', () => {
    const target = session({ sessionId: 's1', abbreviation: 'SVS401' });
    expect(findRepeat([target], target)).toBeUndefined();
  });

  it('abbreviationが無いセッションはundefinedを返す', () => {
    const target = session({ sessionId: 's1' });
    expect(findRepeat([target], target)).toBeUndefined();
  });
});

describe('findSimilarSessions', () => {
  it('同じtopicsを持つ別セッションを見つける（自分自身は除外）', () => {
    const target = session({ sessionId: 's1', topics: ['Security'] });
    const similar = session({ sessionId: 's2', topics: ['Security', 'Networking'] });
    const unrelated = session({ sessionId: 's3', topics: ['Kubernetes'] });

    const found = findSimilarSessions([target, similar, unrelated], target);
    expect(found.map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('同じSpeakerを持つ別セッションを見つける', () => {
    const target = session({ sessionId: 's1', speakers: [{ name: '田中太郎' }] });
    const similar = session({ sessionId: 's2', speakers: [{ name: '田中太郎' }] });

    const found = findSimilarSessions([target, similar], target);
    expect(found.map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('トピックもSpeakerも一致しなければ空配列', () => {
    const target = session({ sessionId: 's1', topics: ['Security'] });
    const unrelated = session({ sessionId: 's2', topics: ['Kubernetes'] });
    expect(findSimilarSessions([target, unrelated], target)).toEqual([]);
  });
});

describe('recommendForConflict', () => {
  it('企画書5.4の例：代替が無いセッションを推奨し、他は回収可否を理由として示す', () => {
    const svs401 = session({ sessionId: 'svs401', abbreviation: 'SVS401', topics: ['Agentic AI'] });
    const dat205 = session({ sessionId: 'dat205', abbreviation: 'DAT205' });
    const dat205Repeat = session({ sessionId: 'dat205r', abbreviation: 'DAT205-R' });
    const cmp318 = session({ sessionId: 'cmp318', speakers: [{ name: 'Jane' }] });
    const cmp318Similar = session({ sessionId: 'cmp318b', speakers: [{ name: 'Jane' }] });

    const allSessions = [svs401, dat205, dat205Repeat, cmp318, cmp318Similar];
    const conflicting = [svs401, dat205, cmp318];

    const result = recommendForConflict(conflicting, allSessions);

    expect(result.recommended.sessionId).toBe('svs401');
    expect(result.reasons.svs401).toContain('今回のみ');
    expect(result.reasons.dat205).toContain('再演');
    expect(result.reasons.cmp318).toContain('同じSpeaker');
  });
});

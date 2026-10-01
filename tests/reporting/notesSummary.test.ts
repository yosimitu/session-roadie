import { describe, it, expect } from 'vitest';
import { buildNotesSummary } from '../../src/reporting/notesSummary.js';
import type { Session } from '../../src/api/types.js';

describe('buildNotesSummary', () => {
  it('セッションの最初のtopicでメモをグループ化する（企画書 §5.7「帰国後の報告」）', () => {
    const sessions: Session[] = [
      { sessionId: 's1', title: 'SVS401', topics: ['Agentic AI'] },
      { sessionId: 's2', title: 'DAT305', topics: ['Agentic AI', 'Data'] },
      { sessionId: 's3', title: 'CMP210', topics: [] },
    ];
    const notes = {
      s1: '田中さんが絶対見ろと言っていた',
      s2: '来期の移行案件で使う',
      s3: 'たぶん知ってる内容',
    };

    const summary = buildNotesSummary(notes, sessions);

    expect(summary).toContain('## Agentic AI');
    expect(summary).toContain('SVS401: 田中さんが絶対見ろと言っていた');
    expect(summary).toContain('DAT305: 来期の移行案件で使う');
    expect(summary).toContain('## その他');
    expect(summary).toContain('CMP210: たぶん知ってる内容');
  });

  it('メモが無ければその旨を返す', () => {
    expect(buildNotesSummary({}, [])).toBe('メモはありません。');
  });

  it('カタログに存在しないsessionIdのメモは「不明」として扱う', () => {
    const summary = buildNotesSummary({ unknown: 'メモ' }, []);
    expect(summary).toContain('unknown: メモ');
  });
});

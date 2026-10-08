import { describe, it, expect } from 'vitest';
import { buildCatalogRecords, serializeForScript, STATUS_LABELS } from '../../src/reporting/catalogRecords.js';
import { JA_LABELS } from '../../src/reporting/jaLabels.js';
import type { Session } from '../../src/api/types.js';

const none = { reserved: new Set<string>(), favorites: new Set<string>(), newIds: new Set<string>() };

const base: Session = {
  sessionId: 's1', abbreviation: 'AIM101', title: 'Agents 101', abstract: 'About agents.',
  type: 'Workshop', level: '300 – Advanced', venue: 'MGM Grand', room: 'Level 1 | Room 1',
  sessionTime: { date: '2026-11-30', time: '08:30', length: '120' },
  speakers: [{ name: 'A Speaker' }], topics: ['Artificial Intelligence'], roles: ['Developer / Engineer'],
  areasOfInterest: ['Agentic AI'], industries: ['Games'], services: ['Amazon Bedrock'], features: ['Hands-on'],
};

describe('buildCatalogRecords', () => {
  it('セッションを一覧用の軽いレコードに変換する（レベルの区切りはハイフンに揃える）', () => {
    const [r] = buildCatalogRecords([base], none);
    expect(r).toMatchObject({
      id: 's1', c: 'AIM101', t: 'Agents 101', a: 'About agents.', ty: 'Workshop', lv: '300 - Advanced',
      ve: 'MGM Grand', rm: 'Level 1 | Room 1', dt: '2026-11-30', tm: '08:30', ln: 120,
      sp: ['A Speaker'], tp: ['Artificial Intelligence'], rl: ['Developer / Engineer'],
      ar: ['Agentic AI'], in: ['Games'], sv: ['Amazon Bedrock'], ft: ['Hands-on'],
    });
  });

  it('略称が無いときは sessionId をコードにし、欠けた項目は空として扱う', () => {
    const [r] = buildCatalogRecords([{ sessionId: 'x', title: 'No details' }], none);
    expect(r).toMatchObject({ c: 'x', t: 'No details', a: '', ty: '', lv: '', ve: '', dt: '', tm: '', ln: 0, sp: [], tp: [] });
    expect(r.ss).toEqual([]);
  });

  it('予約済み・公式お気に入り・新着の状態を付ける', () => {
    const rs = buildCatalogRecords(
      [base, { ...base, sessionId: 's2' }, { ...base, sessionId: 's3' }],
      { reserved: new Set(['s1']), favorites: new Set(['s1', 's2']), newIds: new Set(['s3']) },
    );
    expect(rs[0].ss).toEqual([STATUS_LABELS.reserved, STATUS_LABELS.favorite]);
    expect(rs[1].ss).toEqual([STATUS_LABELS.favorite]);
    expect(rs[2].ss).toEqual([STATUS_LABELS.isNew]);
  });

  it('予約していないセッションに、空席状況を状態として付ける', () => {
    const seat = (sa: Session['seatAvailability'], extra: Partial<Session> = {}) =>
      buildCatalogRecords([{ ...base, seatAvailability: sa, ...extra }], none)[0];
    expect(seat('available').ss).toEqual([STATUS_LABELS.open]);
    expect(seat('limited').ss).toEqual([STATUS_LABELS.open]);
    expect(seat('veryLimited').ss).toEqual([STATUS_LABELS.open]);
    expect(seat('unavailable').ss).toEqual([STATUS_LABELS.full]);
    expect(seat('walkUp').ss).toEqual([STATUS_LABELS.walkUp]);
    expect(seat(undefined).ss).toEqual([]);
    expect(seat('veryLimited').sa).toBe('veryLimited');
  });

  it('予約済みのセッションには空席状況の状態を付けない', () => {
    const [r] = buildCatalogRecords([{ ...base, seatAvailability: 'unavailable' }], { ...none, reserved: new Set(['s1']) });
    expect(r.ss).toEqual([STATUS_LABELS.reserved]);
  });
});

describe('buildCatalogRecords: おすすめ', () => {
  it('おすすめ度と理由を持たせ、閾値以上なら「おすすめ」の状態を付ける', () => {
    const recs = new Map([
      ['s1', { score: 80, reasons: ['優先1位: セキュリティ', '空席あり'] }],
      ['s2', { score: 59, reasons: ['関心: データ'] }],
    ]);
    const rs = buildCatalogRecords([base, { ...base, sessionId: 's2' }, { ...base, sessionId: 's3' }], none, recs);
    expect(rs[0]).toMatchObject({ rc: 80, rw: ['優先1位: セキュリティ', '空席あり'] });
    expect(rs[0].ss).toContain(STATUS_LABELS.recommend);
    expect(rs[1]).toMatchObject({ rc: 59 });
    expect(rs[1].ss).not.toContain(STATUS_LABELS.recommend); // 閾値（60）未満
    expect(rs[2].rc).toBeUndefined();
    expect(rs[2].rw).toBeUndefined();
  });

  it('おすすめ情報を渡さなければ、従来どおり', () => {
    const [r] = buildCatalogRecords([base], none);
    expect(r.rc).toBeUndefined();
    expect(r.ss).toEqual([]);
  });
});

describe('serializeForScript', () => {
  it('</script> や <!-- を含む文字列でも、scriptタグを閉じない形にする', () => {
    const out = serializeForScript({ t: '</script><script>alert(1)</script> <!-- x' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual({ t: '</script><script>alert(1)</script> <!-- x' });
  });

  it('U+2028 / U+2029 もエスケープする', () => {
    const out = serializeForScript({ t: 'a b c' });
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toEqual({ t: 'a b c' });
  });
});

describe('JA_LABELS', () => {
  it('セッションタイプとレベルの日本語表記を持つ', () => {
    expect(JA_LABELS['Workshop']).toBe('ワークショップ');
    expect(JA_LABELS['300 - Advanced']).toBe('300 - 上級');
  });
});

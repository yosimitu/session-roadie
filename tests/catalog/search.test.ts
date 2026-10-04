import { describe, it, expect } from 'vitest';
import { searchCatalog } from '../../src/catalog/search.js';
import type { Session } from '../../src/api/types.js';

const sessions: Session[] = [
  {
    sessionId: 'a', abbreviation: 'DAT410-R', title: 'Build agentic hybrid retrieval', abstract: 'Aurora PostgreSQL',
    type: 'Builders\' session', level: '400 - Expert', venue: 'MGM Grand', topics: ['Databases'], services: ['Amazon Aurora'],
    sessionTime: { date: '2026-12-02', time: '13:30', length: '60' },
  },
  {
    sessionId: 'b', abbreviation: 'DAT410-R1', title: 'Build agentic hybrid retrieval', abstract: 'Aurora PostgreSQL',
    type: 'Builders\' session', level: '400 - Expert', venue: 'MGM Grand', topics: ['Databases'],
    sessionTime: { date: '2026-11-30', time: '16:00', length: '60' },
  },
  {
    sessionId: 'c', abbreviation: 'ANT301', title: 'Modern data warehouse', abstract: 'Redshift for AI agents',
    type: 'Breakout session', level: '300 - Advanced', venue: 'Venetian', topics: ['Analytics'],
    sessionTime: { date: '2026-11-30', time: '10:30', length: '60' },
  },
];

describe('searchCatalog', () => {
  it('キーワードは大文字小文字を無視してAND。既定ではabstractも対象', () => {
    expect(searchCatalog(sessions, { keywords: ['AGENT'] }).totalCount).toBe(3);
    expect(searchCatalog(sessions, { keywords: ['agent', 'aurora'] }).items.map((i) => i.sessionId)).toEqual(['b', 'a']);
  });

  it('keywordScope: title ならタイトルだけを見る', () => {
    expect(searchCatalog(sessions, { keywords: ['agent'], keywordScope: 'title' }).items.map((i) => i.sessionId)).toEqual(['b', 'a']);
  });

  it('トピック・形式・レベル・日付・会場で絞り込める', () => {
    expect(searchCatalog(sessions, { topics: ['analytics'] }).items.map((i) => i.sessionId)).toEqual(['c']);
    expect(searchCatalog(sessions, { types: ['breakout session'] }).items.map((i) => i.sessionId)).toEqual(['c']);
    expect(searchCatalog(sessions, { levels: ['400'] }).totalCount).toBe(2);
    expect(searchCatalog(sessions, { dates: ['2026-11-30'] }).items.map((i) => i.sessionId)).toEqual(['c', 'b']);
    expect(searchCatalog(sessions, { venues: ['venetian'] }).items.map((i) => i.sessionId)).toEqual(['c']);
    expect(searchCatalog(sessions, { services: ['aurora'] }).items.map((i) => i.sessionId)).toEqual(['a']);
  });

  it('日時順に並べ、他の回（再演）のIDを付ける', () => {
    const items = searchCatalog(sessions, {}).items;
    expect(items.map((i) => i.sessionId)).toEqual(['c', 'b', 'a']);
    expect(items.find((i) => i.sessionId === 'a')?.repeatSessionIds).toEqual(['b']);
    expect(items.find((i) => i.sessionId === 'c')?.repeatSessionIds).toEqual([]);
  });

  it('abstractは既定で返さず、includeAbstractで返す', () => {
    expect(searchCatalog(sessions, {}).items[0].abstract).toBeUndefined();
    expect(searchCatalog(sessions, { includeAbstract: true }).items[0].abstract).toBe('Redshift for AI agents');
  });

  it('limit/offsetでページングし、totalCountは全件数を返す', () => {
    const page = searchCatalog(sessions, { limit: 1, offset: 1 });
    expect(page.totalCount).toBe(3);
    expect(page.items.map((i) => i.sessionId)).toEqual(['b']);
  });
});

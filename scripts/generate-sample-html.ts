// README・提出物に載せる、サンプルの `re-roadie view` を生成する。
// 公式カタログは再配布しない方針なので、セッションはすべて架空（略称は DEMO、ID は sample-）。
// 実行: npx tsx scripts/generate-sample-html.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import type { PersonalTime, Schedule, SeatAvailability, Session } from '../src/api/types.js';
import { computeTravelBlock } from '../src/schedule/travelBlock.js';
import { buildScheduleHtml } from '../src/reporting/scheduleHtml.js';
import type { Lang } from '../src/reporting/i18n.js';
import type { DigestPeriod } from '../src/reporting/digestHtml.js';

const OUT_PATHS = { ja: 'docs/sample/schedule-sample.html', en: 'docs/sample/schedule-sample.en.html' } as const;

interface Seed {
  n: number; // 略称 DEMO<n> と ID の元
  title: string;
  type: string;
  level: string;
  venue: string;
  room: string;
  date: string;
  time: string;
  length: number;
  seat: SeatAvailability;
  topics: string[];
  services?: string[];
}

const SEEDS: Seed[] = [
  { n: 101, title: 'Sample: Designing agent workflows with tool use', type: 'Breakout session', level: '300 - Advanced', venue: 'Venetian', room: 'Level 2 | Hall A', date: '2026-12-01', time: '09:00', length: 60, seat: 'limited', topics: ['Agentic AI'], services: ['Amazon Bedrock'] },
  { n: 102, title: 'Sample: Serverless event pipelines, end to end', type: 'Workshop', level: '300 - Advanced', venue: 'Venetian', room: 'Level 3 | Room 301', date: '2026-12-01', time: '10:30', length: 120, seat: 'veryLimited', topics: ['Serverless'], services: ['AWS Lambda'] },
  { n: 103, title: 'Sample: Cost controls for AI workloads', type: 'Chalk talk', level: '200 - Intermediate', venue: 'Caesars Forum', room: 'Level 1 | Forum 105', date: '2026-12-01', time: '13:30', length: 60, seat: 'available', topics: ['Cost Optimization'] },
  { n: 104, title: 'Sample: Securing MCP servers in production', type: 'Chalk talk', level: '300 - Advanced', venue: 'Caesars Forum', room: 'Level 2 | Forum 210', date: '2026-12-01', time: '14:45', length: 60, seat: 'unavailable', topics: ['Security & Identity', 'Agentic AI'] },
  { n: 105, title: 'Sample: Observability for event-driven systems', type: 'Code talk', level: '300 - Advanced', venue: 'MGM', room: 'Level 1 | Room 101', date: '2026-12-01', time: '15:00', length: 60, seat: 'available', topics: ['Observability'] },
  { n: 106, title: 'Sample: Networking patterns for multi-account setups', type: 'Breakout session', level: '300 - Advanced', venue: 'Wynn', room: 'Level 1 | Lafleur', date: '2026-12-01', time: '16:30', length: 60, seat: 'limited', topics: ['Networking'] },

  { n: 201, title: 'Sample: Retrieval patterns that survive production', type: 'Breakout session', level: '300 - Advanced', venue: 'Venetian', room: 'Level 2 | Hall B', date: '2026-12-02', time: '08:30', length: 60, seat: 'available', topics: ['Agentic AI', 'Data'], services: ['Amazon Bedrock'] },
  { n: 202, title: 'Sample: Build interactive web apps with serverless', type: 'Chalk talk', level: '200 - Intermediate', venue: 'Venetian', room: 'Level 3 | Room 305', date: '2026-12-02', time: '09:45', length: 60, seat: 'limited', topics: ['Serverless'], services: ['AWS Lambda'] },
  { n: 203, title: 'Sample: Agent evaluation, the hands-on lab', type: 'Workshop', level: '300 - Advanced', venue: 'Venetian', room: 'Level 4 | Lab 2', date: '2026-12-02', time: '11:00', length: 120, seat: 'veryLimited', topics: ['Agentic AI'] },
  { n: 204, title: 'Sample: Identity for autonomous agents', type: 'Chalk talk', level: '300 - Advanced', venue: 'Caesars Forum', room: 'Level 1 | Forum 108', date: '2026-12-02', time: '13:00', length: 60, seat: 'walkUp', topics: ['Security & Identity'] },
  { n: 205, title: 'Sample: Kubernetes upgrades without surprises', type: 'Breakout session', level: '300 - Advanced', venue: 'Caesars Forum', room: 'Level 2 | Forum 215', date: '2026-12-02', time: '13:30', length: 60, seat: 'available', topics: ['Containers'] },
  { n: 206, title: 'Sample: Lightning round: five tips for IaC reviews', type: 'Lightning talk', level: '200 - Intermediate', venue: 'MGM', room: 'Level 1 | Theater', date: '2026-12-02', time: '14:30', length: 20, seat: 'available', topics: ['DevOps'] },
  { n: 207, title: 'Sample: Data lake governance in practice', type: 'Breakout session', level: '300 - Advanced', venue: 'Wynn', room: 'Level 1 | Latour', date: '2026-12-02', time: '16:00', length: 60, seat: 'limited', topics: ['Data'] },

  { n: 301, title: 'Sample: Keynote companion: what changed this year', type: 'Breakout session', level: '100 - Foundational', venue: 'Venetian', room: 'Level 2 | Hall A', date: '2026-12-03', time: '08:00', length: 60, seat: 'available', topics: ['Strategy'] },
  { n: 302, title: 'Sample: Resilience drills with chaos experiments', type: 'Workshop', level: '300 - Advanced', venue: 'Caesars Palace', room: 'Level 1 | Octavius 4', date: '2026-12-03', time: '10:00', length: 120, seat: 'unavailable', topics: ['Resilience'] },
  { n: 303, title: 'Sample: Choosing a queue: when to use which', type: 'Chalk talk', level: '200 - Intermediate', venue: 'Venetian', room: 'Level 3 | Room 310', date: '2026-12-03', time: '10:15', length: 60, seat: 'available', topics: ['Serverless', 'Integration'] },
  { n: 304, title: 'Sample: Prompt caching and latency budgets', type: 'Code talk', level: '300 - Advanced', venue: 'Venetian', room: 'Level 3 | Room 312', date: '2026-12-03', time: '13:00', length: 60, seat: 'limited', topics: ['Agentic AI'], services: ['Amazon Bedrock'] },
  { n: 305, title: 'Sample: Game day: recover the broken platform', type: 'Gamified learning', level: '300 - Advanced', venue: 'MGM', room: 'Level 2 | Room 210', date: '2026-12-03', time: '15:00', length: 180, seat: 'veryLimited', topics: ['Resilience', 'DevOps'] },
];

// 新着として印を付ける（比較元に無かったことにする）セッション
const NEW_NUMBERS = [206, 304];
// 予約する・お気に入りにする
const RESERVED_NUMBERS = [101, 103, 106, 201, 202, 207, 301, 303];
const FAVORITE_NUMBERS = [102, 104, 203, 204, 205, 304, 305];

const id = (n: number): string => `sample-${n}`;

function toSession(seed: Seed): Session {
  return {
    sessionId: id(seed.n),
    title: seed.title,
    abbreviation: `DEMO${seed.n}`,
    abstract: 'This is a fictional session used only to illustrate the re-roadie view. It does not exist in the re:Invent catalog.',
    type: seed.type,
    level: seed.level,
    venue: seed.venue,
    room: seed.room,
    isReservable: true,
    seatAvailability: seed.seat,
    sessionTime: { date: seed.date, time: seed.time, length: String(seed.length), timezone: 'PST' },
    topics: seed.topics,
    services: seed.services ?? [],
    tracks: [],
  };
}

const sessions = SEEDS.map(toSession);
const byId = new Map(sessions.map((s) => [s.sessionId, s]));

// 予約済みの連続する2件から、実装と同じ計算で移動ブロックを作る
function buildTravelBlocks(reservedIds: string[]): PersonalTime[] {
  const reserved = reservedIds.map((sid) => byId.get(sid)!).sort((a, b) => `${a.sessionTime?.date}${a.sessionTime?.time}`.localeCompare(`${b.sessionTime?.date}${b.sessionTime?.time}`));
  const blocks: PersonalTime[] = [];
  for (let i = 0; i + 1 < reserved.length; i++) {
    const a = reserved[i];
    const b = reserved[i + 1];
    if (a.sessionTime?.date !== b.sessionTime?.date) continue;
    const result = computeTravelBlock(a, b);
    if (!result?.sufficient || !result.personalTime) continue;
    blocks.push({ personalTimeId: `sample-travel-${i}`, ...result.personalTime });
  }
  return blocks;
}

const reservedIds = RESERVED_NUMBERS.map(id);
const personalTime: PersonalTime[] = [
  { personalTimeId: 'sample-keynote', startDateTime: '2026-12-02T08:00:00', endDateTime: '2026-12-02T09:30:00', title: 'Keynote (sample)', description: 'Fictional keynote block', location: 'Venetian' },
  { personalTimeId: 'sample-dinner', startDateTime: '2026-12-02T18:30:00', endDateTime: '2026-12-02T20:30:00', title: 'Team dinner (sample)', description: 'Fictional personal event' },
  ...buildTravelBlocks(reservedIds),
];

const schedule: Schedule = { reserved: reservedIds, favorites: FAVORITE_NUMBERS.map(id), personalTime };

// 移動ブロックの題名は、実装が日本語で書く（「A → B 移動」）。英語版では英語にする
const withTitles = (lang: Lang): Schedule =>
  lang === 'ja' ? schedule : { ...schedule, personalTime: personalTime.map((p) => ({ ...p, title: p.title.replace(/ 移動$/, ' travel') })) };

// 「更新履歴」タブに出す、架空の日別の差分（新しい期間が先）。実データではない
const retired = toSession({ n: 401, title: 'Sample: Retired session that left the catalog', type: 'Chalk talk', level: '200 - Intermediate', venue: 'Wynn', room: 'Level 1 | Latour', date: '2026-12-02', time: '10:00', length: 60, seat: 'available', topics: ['Data'] });
const movedAfter = byId.get(id(105))!;
const movedBefore: Session = { ...movedAfter, room: 'Level 1 | Room 102', sessionTime: { ...movedAfter.sessionTime!, time: '14:30' } };
const digestPeriods: DigestPeriod[] = [
  { from: '2026-11-17', to: '2026-11-20', diff: { added: [byId.get(id(304))!], removed: [retired], changed: [{ sessionId: id(105), before: movedBefore, after: movedAfter, changedFields: ['room', 'sessionTime'] }] } },
  { from: '2026-11-16', to: '2026-11-17', diff: { added: [byId.get(id(206))!], removed: [], changed: [] } },
  { from: '2026-11-13', to: '2026-11-16', diff: { added: [], removed: [], changed: [] } },
];

function build(lang: Lang): string {
  return buildScheduleHtml({
    schedule: withTitles(lang),
    sessions,
    profile: {
      role: 'クラウドエンジニア（サンプル）',
      purpose: 'learning',
      stamina: 'normal',
      attendance: { firstDay: '2026-12-01', lastDay: '2026-12-03' },
      maxLevel: 300,
      excludeSponsored: true,
      lunchBreak: true,
      interestTopics: ['Agentic AI', 'Serverless', 'Security & Identity'],
    },
    generatedAt: new Date('2026-11-20T00:00:00Z'),
    newSessionIds: NEW_NUMBERS.map(id),
    newBaseline: '2026-11-13',
    digestPeriods,
    lang,
  });
}

mkdirSync('docs/sample', { recursive: true });
for (const lang of ['ja', 'en'] as const) {
  const html = build(lang);
  writeFileSync(OUT_PATHS[lang], html, 'utf-8');
  console.log(`${OUT_PATHS[lang]}: ${sessions.length} sessions, ${schedule.reserved.length} reserved, ${schedule.favorites.length} favorites, ${personalTime.length} personal time, ${(html.length / 1024).toFixed(0)} KB`);
}

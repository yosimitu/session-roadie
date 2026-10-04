import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  authStatusTool,
  authLoginTool,
  authLogoutTool,
  catalogSyncTool,
  catalogSearchTool,
  scheduleOptimizeTool,
  scheduleGetTool,
  schedulePlanTool,
  scheduleApplyTool,
  conflictsGetTool,
  travelBlocksPlanTool,
  travelBlocksApplyTool,
  notesListTool,
  notesAddTool,
  notesReportTool,
  notesRemindersPlanTool,
  notesRemindersApplyTool,
  onboardingSaveTool,
  profileGetTool,
} from './tools.js';
import { ONBOARDING_EVENT_DATES } from '../onboarding/wizard.js';

const eventIdParam = { eventId: z.string().optional().describe('イベントID（省略時は reinvent2026）') };
const sessionIdsParam = {
  reserve: z.array(z.string()).optional().describe('予約したいセッションIDの一覧（あるべき状態）。省略時は予約を現状維持。全取消は [] を明示する'),
  favorite: z.array(z.string()).optional().describe('お気に入りにしたいセッションIDの一覧（あるべき状態）。省略時はお気に入りを現状維持。全解除は [] を明示する'),
};

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `エラー: ${message}` }], isError: true };
}

async function safely<T>(fn: () => Promise<T> | T) {
  try {
    return textResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * re:Roadie のロジックをMCPツールとして公開する（「Claude Code → スキル/コマンド → re:Roadie →
 * AWS Events REST API」という構成の、re:Roadie部分）。
 * 確認プロンプトを持つCLIの apply/travel-blocks/notes apply と異なり、MCPツールは常に非対話で動く。
 * 書き込み系は `*_plan`（差分を見せるだけ）と `*_apply`（実行する）に分け、確認はスキル/コマンド側が
 * planの結果を見てユーザーに確認してから apply を呼ぶ、という2段階フローを前提にする。
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'session-roadie', version: '0.1.0' });

  server.registerTool('auth_status', {
    description: 'Builder IDのサインイン状態を確認する',
    inputSchema: {},
  }, async () => safely(() => authStatusTool()));

  server.registerTool('auth_login', {
    description: 'ブラウザを開いてBuilder IDにサインインする（完了までブラウザでの操作を待つ）',
    inputSchema: {},
  }, async () => safely(() => authLoginTool()));

  server.registerTool('auth_logout', {
    description: 'サインアウトする（refresh tokenを失効させ、ローカルのトークンを削除し、Builder IDのブラウザセッションも終了する）',
    inputSchema: {},
  }, async () => safely(() => authLogoutTool()));

  server.registerTool('catalog_sync', {
    description: 'カタログを全件取得し、ローカルスナップショットとの差分（新規・変更・キャンセル）を返す。sinceに日付(YYYY-MM-DD)を指定すると、その日のスナップショットと比較する（例:「ここ一週間の新着」を知りたい場合は7日前の日付を指定。保存されている日付は結果のavailableDatesで分かる）。省略時は前回保存分と比較する',
    inputSchema: { ...eventIdParam, since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('比較したい過去の日付(YYYY-MM-DD)') },
  }, async ({ eventId, since }) => safely(() => catalogSyncTool(eventId, since)));

  server.registerTool('catalog_search', {
    description: 'ローカルスナップショット（catalog_syncで保存）からセッションを絞り込む。キーワード（AND）・トピック・形式・レベル・日付・会場・サービスで絞れる。結果は日時順で、他の回（再演）のIDも返す。英語のタイトル・abstractをそのまま返す',
    inputSchema: {
      ...eventIdParam,
      keywords: z.array(z.string()).optional().describe('すべて含むキーワード（AND、大文字小文字無視）'),
      keywordScope: z.enum(['title', 'titleAndAbstract']).optional().describe('キーワードの対象（既定 titleAndAbstract。"agent"等の頻出語はtitle推奨）'),
      topics: z.array(z.string()).optional().describe('トピック（OR、完全一致）。例 "Artificial Intelligence", "Business Agents"'),
      types: z.array(z.string()).optional().describe('形式（OR、完全一致）。例 "Workshop", "Breakout session", "Chalk talk", "Builders\' session"'),
      levels: z.array(z.string()).optional().describe('レベルの先頭一致（OR）。例 "300", "400"'),
      dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().describe('開催日（OR、会場のPST日付）'),
      venues: z.array(z.string()).optional().describe('会場の部分一致（OR）。例 "MGM", "Venetian"'),
      services: z.array(z.string()).optional().describe('関連サービスの部分一致（OR）。例 "AgentCore"'),
      includeAbstract: z.boolean().optional().describe('abstractを含めるか（既定false）'),
      limit: z.number().int().min(1).max(200).optional().describe('最大件数（既定50）'),
      offset: z.number().int().min(0).optional(),
      useProfile: z.boolean().optional().describe('datesを省略したとき、profile.yamlの参加日の範囲に絞るか（既定true。適用した値はappliedProfileDefaultsで返す）'),
    },
  }, async ({ eventId, ...query }) => safely(() => catalogSearchTool(query, eventId)));

  server.registerTool('schedule_optimize', {
    description: '候補セッションIDから、再演（-R/-R1…）への差し替え・個人予定（基調講演など）・会場間の移動時間を考慮して、重ならずに参加できる本数が最大の組み合わせを選ぶ（実行はしない）。profile.yamlの体力（1日の上限本数・最低空き時間）・目的（優先形式）・参加日を既定値として使い、適用した値はappliedOptionsで返す。結果のreserveをschedule_planに渡す。droppedには入らなかった候補と各回の衝突相手を返す',
    inputSchema: {
      ...eventIdParam,
      candidates: z.array(z.string()).min(1).describe('参加したい候補のセッションID（どの回のIDでもよい。同じ元番号の回は1つにまとめる）'),
      considerTravelTime: z.boolean().optional().describe('会場間の移動時間を考慮するか（既定true。移動時間は概算値）'),
      respectPersonalTime: z.boolean().optional().describe('個人予定と重なる回を避けるか（既定true。re:Roadieが書き込んだ移動時間・リマインダーは対象外）'),
      useProfile: z.boolean().optional().describe('profile.yamlの回答を既定値として使うか（既定true）'),
      maxSessionsPerDay: z.number().int().min(1).optional().describe('1日あたりの上限本数（指定するとプロフィールより優先）'),
      minGapMinutes: z.number().int().min(0).optional().describe('連続するセッション間に最低限あける分数（指定するとプロフィールより優先）'),
      preferredTypes: z.array(z.string()).optional().describe('優先する形式。本数が同じ解の中で多く含む方を選ぶ（指定するとプロフィールより優先）'),
      firstDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('参加できる初日（会場PST。指定するとプロフィールより優先）'),
      lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('参加できる最終日（会場PST。指定するとプロフィールより優先）'),
    },
  }, async ({ candidates, ...options }) => safely(() => scheduleOptimizeTool(candidates, options)));

  server.registerTool('profile_get', {
    description: 'onboarding_saveで保存したプロフィール（profile.yaml）と意図（intent.txt）、そこから導かれるschedule_optimizeの既定値を返す。予定を組む前に読む',
    inputSchema: {},
  }, async () => safely(() => profileGetTool()));

  server.registerTool('schedule_get', {
    description: '現在のスケジュール（予約・お気に入り・個人予定）を取得する',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => scheduleGetTool(eventId)));

  server.registerTool('schedule_plan', {
    description: 'あるべき状態（予約・お気に入りにしたいセッションID）と実スケジュールの差分を計算する（実行はしない）',
    inputSchema: { ...sessionIdsParam, ...eventIdParam },
  }, async ({ reserve, favorite, eventId }) => safely(() => schedulePlanTool(reserve, favorite, eventId)));

  server.registerTool('schedule_apply', {
    description: 'あるべき状態（予約・お気に入りにしたいセッションID）を実際に実行する。実行前にschedule_planで差分を確認することを推奨。実行後は自動でGetScheduleを取り直し、残っている差分も一緒に返す',
    inputSchema: { ...sessionIdsParam, ...eventIdParam },
  }, async ({ reserve, favorite, eventId }) => safely(() => scheduleApplyTool(reserve, favorite, eventId)));

  server.registerTool('conflicts_get', {
    description: '予約済みセッションの時間重複を検出し、再演・類似セッションの有無という事実に基づく根拠つきで諦める優先順位を提案する（sessionConflicts）。個人予定（基調講演など）と重なる予約も返す（personalTimeConflicts）',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => conflictsGetTool(eventId)));

  server.registerTool('travel_blocks_plan', {
    description: '予約済みセッション間の移動時間を計算する（実行はしない）。間に合わない場合は警告として返す',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => travelBlocksPlanTool(eventId)));

  server.registerTool('travel_blocks_apply', {
    description: '移動時間が確保できるブロックをCreatePersonalTimeで実際に公式スケジュールへ書き込む',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => travelBlocksApplyTool(eventId)));

  server.registerTool('notes_list', {
    description: '保存済みのメモを一覧で返す',
    inputSchema: {},
  }, async () => safely(() => notesListTool()));

  server.registerTool('notes_add', {
    description: 'セッションにメモを追加する（既存のメモは上書きする）',
    inputSchema: { sessionId: z.string(), text: z.string() },
  }, async ({ sessionId, text }) => safely(() => notesAddTool(sessionId, text)));

  server.registerTool('notes_report', {
    description: 'メモをテーマ別に整理した帰国後報告をMarkdownで返す',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => notesReportTool(eventId)));

  server.registerTool('notes_reminders_plan', {
    description: 'メモがあるセッションの直前に表示するリマインダー候補を計算する（実行はしない）',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => notesRemindersPlanTool(eventId)));

  server.registerTool('notes_reminders_apply', {
    description: 'メモのリマインダーをCreatePersonalTimeで実際に公式スケジュールへ書き込む',
    inputSchema: eventIdParam,
  }, async ({ eventId }) => safely(() => notesRemindersApplyTool(eventId)));

  server.registerTool('onboarding_save', {
    description: '初めての参加者向け。5つの質問（普段の仕事/今回の目的/体力/参加日/関心テーマ）の回答から初期プロフィールと意図を保存する。参加日と関心テーマは任意',
    inputSchema: {
      role: z.enum(['infrastructure', 'appDev', 'data', 'management']).describe('普段の仕事'),
      purpose: z.enum(['learning', 'research', 'networking', 'report']).describe('今回の一番の目的'),
      stamina: z.enum(['packed', 'normal', 'relaxed']).describe('体力に自信があるか'),
      firstDay: z.enum(ONBOARDING_EVENT_DATES).optional().describe('参加できる初日（会場PST）'),
      lastDay: z.enum(ONBOARDING_EVENT_DATES).optional().describe('参加できる最終日（会場PST）'),
      interests: z.array(z.enum(['agenticAI', 'security', 'data', 'appDev', 'infrastructure', 'migration'])).optional()
        .describe('関心テーマ（複数可、「特になし」は空配列か省略）。agenticAI=Agentic AI・生成AI, security=セキュリティ, data=データ・分析, appDev=アプリ開発・サーバーレス, infrastructure=インフラ・ネットワーク, migration=移行・運用'),
    },
  }, async (answers) => safely(() => onboardingSaveTool(answers)));

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

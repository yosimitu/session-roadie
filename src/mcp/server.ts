import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  authStatusTool,
  authLoginTool,
  authLogoutTool,
  catalogSyncTool,
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
} from './tools.js';

const eventIdParam = { eventId: z.string().optional().describe('イベントID（省略時は reinvent2026）') };
const sessionIdsParam = {
  reserve: z.array(z.string()).default([]).describe('予約したいセッションIDの一覧（あるべき状態）'),
  favorite: z.array(z.string()).default([]).describe('お気に入りにしたいセッションIDの一覧（あるべき状態）'),
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
    description: '予約済みセッションの時間重複を検出し、再演・類似セッションの有無という事実に基づく根拠つきで諦める優先順位を提案する',
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
    description: '初めての参加者向け。3つの質問（普段の仕事/今回の目的/体力）の回答から初期プロフィールと意図を保存する',
    inputSchema: {
      role: z.enum(['infrastructure', 'appDev', 'data', 'management']).describe('普段の仕事'),
      purpose: z.enum(['learning', 'research', 'networking', 'report']).describe('今回の一番の目的'),
      stamina: z.enum(['packed', 'normal', 'relaxed']).describe('体力に自信があるか'),
    },
  }, async ({ role, purpose, stamina }) => safely(() => onboardingSaveTool({ role, purpose, stamina })));

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

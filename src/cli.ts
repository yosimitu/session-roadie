#!/usr/bin/env node
import { Command } from 'commander';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ApiClient } from './api/client.js';
import { TokenStore } from './auth/tokenStore.js';
import { runSync } from './commands/sync.js';
import { runAuthStatus } from './commands/authStatus.js';
import { runScheduleStatus } from './commands/scheduleStatus.js';
import { loadDesiredState } from './schedule/desiredStateStore.js';
import { reconcile } from './schedule/reconcile.js';
import { executeReconcilePlan } from './commands/applyPlan.js';
import type { BulkResult, Schedule } from './api/types.js';

const DEFAULT_EVENT_ID = 'reinvent2026';
const DATA_DIR = join(process.cwd(), 'data');

function createClient(): ApiClient {
  const tokenStore = new TokenStore(join(DATA_DIR, 'token.json'));
  return new ApiClient({ getAccessToken: () => tokenStore.load()?.accessToken });
}

async function askConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function printBulkResult(label: string, result: BulkResult): void {
  console.log(`${label}: 成功 ${result.successful.length}件 / 失敗 ${result.failed.length}件`);
  for (const id of result.successful) console.log(`  ✓ ${id}`);
  for (const f of result.failed) console.log(`  ✕ ${f.sessionId}（${f.code}）`);
}

const program = new Command();
program
  .name('night-shift')
  .description('re:Invent の予定を夜のうちに整えるローカルエージェント')
  .version('0.1.0');

program
  .command('sync')
  .description('カタログ全件を取得し、前回のローカルスナップショットとの差分を表示する')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .action(async (options: { eventId: string }) => {
    const diff = await runSync(createClient(), options.eventId, DATA_DIR);
    console.log(`新規: ${diff.added.length}件 / 変更: ${diff.changed.length}件 / キャンセル: ${diff.removed.length}件`);
    for (const s of diff.added) console.log(`  + ${s.sessionId} ${s.title}`);
    for (const c of diff.changed) console.log(`  * ${c.sessionId} ${c.after.title} (${c.changedFields.join(', ')})`);
    for (const s of diff.removed) console.log(`  - ${s.sessionId} ${s.title}`);
  });

program
  .command('schedule')
  .description('現在のスケジュール（予約・お気に入り・個人予定）を表示する')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .action(async (options: { eventId: string }) => {
    const schedule = await runScheduleStatus(createClient(), options.eventId);
    console.log(`予約: ${schedule.reserved.length}件 / お気に入り: ${schedule.favorites.length}件 / 個人予定: ${schedule.personalTime.length}件`);
    for (const id of schedule.reserved) console.log(`  予約: ${id}`);
    for (const id of schedule.favorites) console.log(`  お気に入り: ${id}`);
    for (const pt of schedule.personalTime) console.log(`  個人予定: ${pt.startDateTime} ${pt.title}`);
  });

program
  .command('apply <desiredStateFile>')
  .description('あるべき状態（予約・お気に入りのセッションID一覧）を実スケジュールと突き合わせ、差分だけ実行する（企画書 §5.2・§5.9）')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('-y, --yes', '確認プロンプトをスキップする', false)
  .action(async (desiredStateFile: string, options: { eventId: string; yes: boolean }) => {
    const client = createClient();
    const desired = loadDesiredState(desiredStateFile);
    const before = await runScheduleStatus(client, options.eventId);
    const plan = reconcile(desired, before);

    const hasChanges = [plan.toReserve, plan.toCancelReservation, plan.toFavorite, plan.toUnfavorite].some((l) => l.length > 0);
    if (!hasChanges) {
      console.log('現在の状態は意図と一致しています。');
      return;
    }

    console.log('これから行う操作：');
    for (const id of plan.toReserve) console.log(`  予約する    ${id}`);
    for (const id of plan.toCancelReservation) console.log(`  予約を外す  ${id}`);
    for (const id of plan.toFavorite) console.log(`  お気に入り  ${id}`);
    for (const id of plan.toUnfavorite) console.log(`  お気に入り解除  ${id}`);

    if (!options.yes && !(await askConfirmation('実行しますか？'))) {
      console.log('キャンセルしました。');
      return;
    }

    const result = await executeReconcilePlan(client, options.eventId, plan);
    printBulkResult('予約', result.reserve);
    printBulkResult('お気に入り', result.favorite);
    for (const c of result.cancelReservation) console.log(`予約解除 ${c.sessionId}: ${c.status}`);
    for (const u of result.unfavorite) console.log(`お気に入り解除 ${u.sessionId}: ${u.status}`);

    // 企画書 §5.9: 実行後に必ずGetScheduleで実際の状態を取り直し、意図と突き合わせる
    const after: Schedule = await runScheduleStatus(client, options.eventId);
    const remaining = reconcile(desired, after);
    const stillHasChanges = [remaining.toReserve, remaining.toCancelReservation, remaining.toFavorite, remaining.toUnfavorite].some((l) => l.length > 0);
    console.log(stillHasChanges
      ? '一部が意図と一致していません。再度 apply を実行してください（部分失敗は自動では再試行しません）。'
      : '現在の状態は意図と一致しています。');
  });

const auth = program.command('auth').description('Builder ID サインインの状態管理');
auth
  .command('status')
  .description('サインイン状態を表示する')
  .action(() => {
    const tokenStore = new TokenStore(join(DATA_DIR, 'token.json'));
    const status = runAuthStatus(tokenStore);
    if (status.signedIn) {
      console.log(`サインイン済み（有効期限: ${new Date(status.expiresAt!).toISOString()}）`);
    } else {
      console.log('未サインイン');
    }
  });

program.parseAsync(process.argv);

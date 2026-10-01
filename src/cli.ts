#!/usr/bin/env node
import { Command } from 'commander';
import { join } from 'node:path';
import { ApiClient } from './api/client.js';
import { TokenStore } from './auth/tokenStore.js';
import { runSync } from './commands/sync.js';
import { runAuthStatus } from './commands/authStatus.js';
import { runScheduleStatus } from './commands/scheduleStatus.js';

const DEFAULT_EVENT_ID = 'reinvent2026';
const DATA_DIR = join(process.cwd(), 'data');

function createClient(): ApiClient {
  const tokenStore = new TokenStore(join(DATA_DIR, 'token.json'));
  return new ApiClient({ getAccessToken: () => tokenStore.load()?.accessToken });
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

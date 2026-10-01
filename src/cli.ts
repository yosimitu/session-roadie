#!/usr/bin/env node
import { Command } from 'commander';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import { stringify } from 'yaml';
import { ApiError } from './api/client.js';
import { signIn, signOut } from './auth/signIn.js';
import { runSync } from './commands/sync.js';
import { runAuthStatus } from './commands/authStatus.js';
import { runScheduleStatus } from './commands/scheduleStatus.js';
import { loadDesiredState } from './schedule/desiredStateStore.js';
import { reconcile } from './schedule/reconcile.js';
import { executeReconcilePlan } from './commands/applyPlan.js';
import { planTravelBlocks } from './commands/travelBlocks.js';
import { loadSnapshot } from './catalog/store.js';
import { createPersonalTime, resolvePersonalTimeId } from './schedule/personalTime.js';
import { loadNotes, saveNotes } from './profile/notesStore.js';
import { buildNoteReminder } from './schedule/noteReminder.js';
import { buildNotesSummary } from './reporting/notesSummary.js';
import { buildProfileFromOnboarding, buildIntentFromOnboarding, type OnboardingRole, type OnboardingPurpose, type OnboardingStamina } from './onboarding/wizard.js';
import { findConflicts } from './commands/conflicts.js';
import { recommendForConflict } from './planning/alternatives.js';
import { DEFAULT_EVENT_ID, DATA_DIR, NOTES_PATH, getTokenStore, createClient } from './runtimeContext.js';
import type { BulkResult, Schedule, Session } from './api/types.js';

// 対話するコマンド1回の実行につきreadlineインターフェースは1つだけ作る。
// パイプ入力（テスト・自動化実行）では readline が全行を同じティックで同期的に 'line' イベント
// として発火するため、question() はおろか素朴な「1問ずつ待ち受け登録」も2問目以降を取りこぼす。
// 届いた行を一旦キューに貯め、askLine側がそれを順番に取り出す方式にして取りこぼしを防ぐ。
let sharedPrompter: Interface | undefined;
const lineQueue: string[] = [];
const waitingResolvers: ((line: string) => void)[] = [];

function getPrompter(): Interface {
  if (!sharedPrompter) {
    sharedPrompter = createInterface({ input: process.stdin, output: process.stdout });
    sharedPrompter.on('line', (line) => {
      const resolve = waitingResolvers.shift();
      if (resolve) resolve(line);
      else lineQueue.push(line);
    });
  }
  return sharedPrompter;
}

function closePrompter(): void {
  sharedPrompter?.close();
  sharedPrompter = undefined;
  lineQueue.length = 0;
  waitingResolvers.length = 0;
}

function askLine(prompt: string): Promise<string> {
  getPrompter();
  process.stdout.write(prompt);
  const queued = lineQueue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => {
    waitingResolvers.push(resolve);
  });
}

async function askConfirmation(question: string): Promise<boolean> {
  const answer = await askLine(`${question} [y/N] `);
  return answer.trim().toLowerCase() === 'y';
}

async function askChoice<T extends string>(question: string, choices: { value: T; label: string }[]): Promise<T> {
  console.log(question);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));
  const answer = await askLine('番号を選んでください: ');
  const index = Number(answer.trim()) - 1;
  return choices[index]?.value ?? choices[0].value;
}

function printBulkResult(label: string, result: BulkResult): void {
  console.log(`${label}: 成功 ${result.successful.length}件 / 失敗 ${result.failed.length}件`);
  for (const id of result.successful) console.log(`  ✓ ${id}`);
  for (const f of result.failed) console.log(`  ✕ ${f.sessionId}（${f.code}）`);
}

const program = new Command();
program
  .name('re-roadie')
  .description('Session Roadie（愛称: re:Roadie） — re:Invent の予定を裏方として整え、公式アプリに書き戻すローカルエージェント')
  .version('0.1.0');

program
  .command('init')
  .description('初めての参加者向けの対話セットアップ。YAMLを直接書かずに初期プロフィール・意図を作る（企画書 §5.1）')
  .action(async () => {
    try {
      const role = await askChoice<OnboardingRole>('普段の仕事は？', [
        { value: 'infrastructure', label: 'インフラ' },
        { value: 'appDev', label: 'アプリ開発' },
        { value: 'data', label: 'データ' },
        { value: 'management', label: '管理職' },
      ]);
      const purpose = await askChoice<OnboardingPurpose>('今回の一番の目的は？', [
        { value: 'learning', label: '学習' },
        { value: 'research', label: '情報収集' },
        { value: 'networking', label: '人脈' },
        { value: 'report', label: '社内報告' },
      ]);
      const stamina = await askChoice<OnboardingStamina>('体力に自信は？', [
        { value: 'packed', label: '詰め込みたい' },
        { value: 'normal', label: '普通' },
        { value: 'relaxed', label: '余裕を持ちたい' },
      ]);

      const answers = { role, purpose, stamina };
      const profile = buildProfileFromOnboarding(answers);
      const intent = buildIntentFromOnboarding(answers);

      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(join(DATA_DIR, 'profile.yaml'), stringify(profile), 'utf-8');
      writeFileSync(join(DATA_DIR, 'intent.txt'), intent, 'utf-8');

      console.log('\n保存しました:');
      console.log(`  ${join(DATA_DIR, 'profile.yaml')}`);
      console.log(`  ${join(DATA_DIR, 'intent.txt')}`);
      console.log(`\n意図: ${intent}`);
    } finally {
      closePrompter();
    }
  });

program
  .command('sync')
  .description('カタログ全件を取得し、前回のローカルスナップショットとの差分を表示する')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .action(async (options: { eventId: string }) => {
    const diff = await runSync(await createClient(), options.eventId, DATA_DIR);
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
    const schedule = await runScheduleStatus(await createClient(), options.eventId);
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
    try {
      const client = await createClient();
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
    } finally {
      closePrompter();
    }
  });

program
  .command('travel-blocks')
  .description('予約済みセッション間の移動時間をCreatePersonalTimeで確保する（企画書 §5.3）')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('-y, --yes', '確認プロンプトをスキップする', false)
  .action(async (options: { eventId: string; yes: boolean }) => {
    try {
      const client = await createClient();
      const schedule = await runScheduleStatus(client, options.eventId);
      const snapshot = loadSnapshot(options.eventId, DATA_DIR) ?? [];
      const snapshotById = new Map(snapshot.map((s) => [s.sessionId, s]));

      const reservedSessions = schedule.reserved
        .map((id) => snapshotById.get(id))
        .filter((s): s is Session => Boolean(s));
      const missingIds = schedule.reserved.filter((id) => !snapshotById.has(id));
      if (missingIds.length > 0) {
        console.log(`警告: ローカルスナップショットに無いセッションがあります（先に sync を実行してください）: ${missingIds.join(', ')}`);
      }

      const blocks = planTravelBlocks(reservedSessions);
      for (const blk of blocks) {
        if (!blk.result.sufficient) {
          console.log(`⚠ ${blk.from.sessionId} → ${blk.to.sessionId}: 移動時間が不足（必要${blk.result.requiredMinutes}分 / 空き${blk.result.availableMinutes}分）`);
        }
      }

      const candidates = blocks
        .filter((blk) => blk.result.sufficient && blk.result.personalTime)
        .filter((blk) => !resolvePersonalTimeId(schedule, blk.result.personalTime!));

      if (candidates.length === 0) {
        console.log('新規に確保すべき移動時間はありません。');
        return;
      }

      console.log('これから確保する移動時間：');
      for (const blk of candidates) {
        const pt = blk.result.personalTime!;
        console.log(`  ${pt.startDateTime} - ${pt.endDateTime}  ${pt.title}`);
      }

      if (!options.yes && !(await askConfirmation('実行しますか？'))) {
        console.log('キャンセルしました。');
        return;
      }

      for (const blk of candidates) {
        await createPersonalTime(client, options.eventId, blk.result.personalTime!);
      }
      console.log(`${candidates.length}件の移動時間を確保しました。`);
    } finally {
      closePrompter();
    }
  });

program
  .command('conflicts')
  .description('予約済みセッションの時間重複を検出し、諦める判断材料（再演・類似セッション）を根拠つきで表示する（企画書 §5.4）')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .action(async (options: { eventId: string }) => {
    const client = await createClient();
    const schedule = await runScheduleStatus(client, options.eventId);
    const snapshot = loadSnapshot(options.eventId, DATA_DIR) ?? [];
    const snapshotById = new Map(snapshot.map((s) => [s.sessionId, s]));
    const reservedSessions = schedule.reserved
      .map((id) => snapshotById.get(id))
      .filter((s): s is Session => Boolean(s));

    const groups = findConflicts(reservedSessions);
    if (groups.length === 0) {
      console.log('時間が重複している予約はありません。');
      return;
    }

    for (const group of groups) {
      const { recommended, reasons } = recommendForConflict(group, snapshot);
      console.log(`${group.map((s) => s.sessionId).join(', ')} が競合しています。`);
      console.log(`推奨: ${recommended.sessionId} に参加`);
      for (const s of group) console.log(`  ${s.sessionId} → ${reasons[s.sessionId]}`);
      console.log('');
    }
  });

const notes = program.command('notes').description('セッションへのメモ（企画書 §5.7）');
notes
  .command('list')
  .description('保存済みのメモを一覧表示する')
  .action(() => {
    const all = loadNotes(NOTES_PATH);
    const entries = Object.entries(all);
    if (entries.length === 0) {
      console.log('メモはありません。');
      return;
    }
    for (const [sessionId, text] of entries) console.log(`${sessionId}: ${text}`);
  });

notes
  .command('add <sessionId> <text>')
  .description('セッションにメモを追加する（既存のメモは上書きする）')
  .action((sessionId: string, text: string) => {
    const all = loadNotes(NOTES_PATH);
    saveNotes(NOTES_PATH, { ...all, [sessionId]: text });
    console.log(`メモを保存しました: ${sessionId}`);
  });

notes
  .command('report')
  .description('メモをテーマ別に整理した帰国後報告を出力する')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .action((options: { eventId: string }) => {
    const all = loadNotes(NOTES_PATH);
    const snapshot = loadSnapshot(options.eventId, DATA_DIR) ?? [];
    console.log(buildNotesSummary(all, snapshot));
  });

notes
  .command('apply')
  .description('メモがあるセッションの直前にリマインダーをCreatePersonalTimeで確保する')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('-y, --yes', '確認プロンプトをスキップする', false)
  .action(async (options: { eventId: string; yes: boolean }) => {
    try {
      const client = await createClient();
      const allNotes = loadNotes(NOTES_PATH);
      const schedule = await runScheduleStatus(client, options.eventId);
      const snapshot = loadSnapshot(options.eventId, DATA_DIR) ?? [];
      const snapshotById = new Map(snapshot.map((s) => [s.sessionId, s]));

      const reminders = Object.entries(allNotes)
        .map(([sessionId, text]) => {
          const session = snapshotById.get(sessionId);
          if (!session) return undefined;
          const personalTime = buildNoteReminder(session, text);
          return personalTime ? { sessionId, personalTime } : undefined;
        })
        .filter((r): r is { sessionId: string; personalTime: NonNullable<ReturnType<typeof buildNoteReminder>> } => Boolean(r))
        .filter((r) => !resolvePersonalTimeId(schedule, r.personalTime));

      if (reminders.length === 0) {
        console.log('新規に確保すべきメモのリマインダーはありません。');
        return;
      }

      console.log('これから確保するリマインダー：');
      for (const r of reminders) console.log(`  ${r.personalTime.startDateTime} - ${r.personalTime.endDateTime}  ${r.personalTime.title}`);

      if (!options.yes && !(await askConfirmation('実行しますか？'))) {
        console.log('キャンセルしました。');
        return;
      }

      for (const r of reminders) await createPersonalTime(client, options.eventId, r.personalTime);
      console.log(`${reminders.length}件のリマインダーを確保しました。`);
    } finally {
      closePrompter();
    }
  });

const auth = program.command('auth').description('Builder ID サインインの状態管理');
auth
  .command('status')
  .description('サインイン状態を表示する')
  .action(() => {
    const status = runAuthStatus(getTokenStore());
    if (status.signedIn) {
      console.log(`サインイン済み（有効期限: ${new Date(status.expiresAt!).toISOString()}）`);
    } else {
      console.log('未サインイン');
    }
  });

auth
  .command('login')
  .description('ブラウザでBuilder IDにサインインする')
  .action(async () => {
    console.log('ブラウザを開きます。Builder IDでサインインしてください…');
    const token = await signIn(getTokenStore());
    console.log(`サインインしました（有効期限: ${new Date(token.expiresAt).toISOString()}）`);
  });

auth
  .command('logout')
  .description('サインアウトする（refresh tokenを失効させ、ローカルのトークンを削除し、Builder IDのブラウザセッションも終了する）')
  .action(async () => {
    await signOut(getTokenStore());
    console.log('サインアウトしました。');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof ApiError) {
    console.error(`APIエラー（HTTP ${err.status}）: ${JSON.stringify(err.body)}`);
  } else if (err instanceof Error) {
    console.error(`エラー: ${err.message}`);
  } else {
    console.error('不明なエラーが発生しました:', err);
  }
  closePrompter();
  process.exitCode = 1;
});

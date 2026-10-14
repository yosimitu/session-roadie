#!/usr/bin/env node
import { Command } from 'commander';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import { stringify } from 'yaml';
import { toRoadieError, formatRoadieErrorForCli } from './errors.js';
import { signIn, signOut } from './auth/signIn.js';
import { runSync, runSyncSince } from './commands/sync.js';
import type { CatalogDiff } from './catalog/diff.js';
import { runAuthStatus } from './commands/authStatus.js';
import { runScheduleStatus } from './commands/scheduleStatus.js';
import { loadDesiredState } from './schedule/desiredStateStore.js';
import { reconcile } from './schedule/reconcile.js';
import { executeReconcilePlan, verifyAfterApply, hasApplyFailure, type StepResult, type ItemResult } from './commands/applyPlan.js';
import { buildTravelBlockPlan, applyTravelBlocks } from './commands/travelBlocks.js';
import { loadSnapshot } from './catalog/store.js';
import { loadNotes, saveNotes } from './profile/notesStore.js';
import { buildNoteReminderPlan, applyNoteReminders } from './commands/noteReminders.js';
import { buildNotesSummary } from './reporting/notesSummary.js';
import {
  buildProfileFromOnboarding, buildIntentFromOnboarding, parseFixedEvent, ONBOARDING_EVENT_DATES, INTEREST_OPTIONS,
  type OnboardingRole, type OnboardingPurpose, type OnboardingStamina, type OnboardingInterest,
} from './onboarding/wizard.js';
import type { FixedEvent } from './profile/profileStore.js';
import { findConflicts, findPersonalTimeConflicts } from './commands/conflicts.js';
import { recommendForConflict } from './planning/alternatives.js';
import { hasPlanChanges, saveScheduleBackup } from './schedule/backup.js';
import { runNowGo, runSeatForecast, runDetour, formatNowGo, formatForecast, formatDetours, parseVenueLocalTime } from './commands/insights.js';
import { DEFAULT_EVENT_ID, DATA_DIR, NOTES_PATH, PROFILE_PATH, SCHEDULE_HTML_PATH, getTokenStore, createClient } from './runtimeContext.js';
import { runScheduleView } from './commands/scheduleView.js';
import { loadProfile } from './profile/profileStore.js';
import { startMcpServer } from './mcp/server.js';
import type { BulkResult, Session } from './api/types.js';
import { runWatchOnce } from './commands/watch.js';
import { formatWatchReport, summarizeForNotification, formatWatchEvents, notifyDesktop } from './commands/watchReport.js';
import { parseIntervalMinutes, runWatchLoop } from './commands/watchLoop.js';

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

async function askMultiChoice<T extends string>(question: string, choices: { value: T; label: string }[]): Promise<T[]> {
  console.log(question);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));
  const answer = await askLine('番号をカンマ区切りで（特になしはそのままEnter）: ');
  const picked = answer.split(',').map((s) => choices[Number(s.trim()) - 1]?.value).filter((v): v is T => Boolean(v));
  return [...new Set(picked)];
}

/** 会食・社内会議など動かせない予定を、空行が来るまで1行ずつ受け取る。形式が違う行は理由を表示して聞き直す */
async function askFixedEvents(): Promise<FixedEvent[]> {
  console.log('動かせない予定（会食・社内会議など）は？ 公式アプリには書き込まず、予定の組み立てで避けるだけです');
  const events: FixedEvent[] = [];
  for (;;) {
    const line = (await askLine('  例「12/1 18:00-20:00 会食」（なければそのままEnter）: ')).trim();
    if (!line) return events;
    try {
      events.push(parseFixedEvent(line));
    } catch (err) {
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function printBulkResult(label: string, result: BulkResult): void {
  console.log(`${label}: 成功 ${result.successful.length}件 / 失敗 ${result.failed.length}件`);
  for (const id of result.successful) console.log(`  ✓ ${id}`);
  for (const f of result.failed) console.log(`  ✕ ${f.sessionId}（${f.code}）`);
}

function printFailedStep(label: string, step: Extract<StepResult<unknown>, { ok: false }>): void {
  if ('skipped' in step) {
    console.log(`${label}: 認証切れのため未実行`);
    return;
  }
  console.log(`${label}: 失敗`);
  for (const line of formatRoadieErrorForCli(step.error)) console.log(`  ${line}`);
}

function printBulkStep(label: string, step: StepResult<BulkResult>): void {
  if (step.ok) printBulkResult(label, step.value);
  else printFailedStep(label, step);
}

function printItemStep(label: string, step: StepResult<ItemResult[]>): void {
  if (!step.ok) {
    printFailedStep(label, step);
    return;
  }
  for (const item of step.value) {
    if ('error' in item) {
      console.log(`${label} ${item.sessionId}: 失敗`);
      for (const line of formatRoadieErrorForCli(item.error)) console.log(`  ${line}`);
    } else if ('skipped' in item) console.log(`${label} ${item.sessionId}: 未実行`);
    else console.log(`${label} ${item.sessionId}: ${item.status}`);
  }
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

      const dayChoices = [
        { value: '', label: '未定（全日程）' },
        ...ONBOARDING_EVENT_DATES.map((d) => ({ value: d, label: d })),
      ];
      const firstDay = (await askChoice('参加できる初日は？', dayChoices)) || undefined;
      const lastDay = (await askChoice('参加できる最終日は？', dayChoices)) || undefined;
      const interests = await askMultiChoice<OnboardingInterest>(
        '関心のあるテーマは？（任意・複数可）',
        (Object.keys(INTEREST_OPTIONS) as OnboardingInterest[]).map((value) => ({ value, label: INTEREST_OPTIONS[value].label })),
      );
      // 2つ以上選んだときだけ、優先順位を聞く（選んだ番号の並びがそのまま順位。省略はEnter）
      const themePriority = interests.length >= 2
        ? await askMultiChoice<OnboardingInterest>(
          '選んだテーマの優先順位は？（任意。1位から順に番号をカンマ区切りで。省略するとお気に入りの傾向から決めます）',
          interests.map((value) => ({ value, label: INTEREST_OPTIONS[value].label })),
        )
        : [];

      // 以下は任意。先頭の選択肢（制限なし・含める・空けない）が既定値
      const maxLevelChoice = await askChoice<'' | '200' | '300'>('希望するレベルは？', [
        { value: '', label: '制限なし（400以上も可）' },
        { value: '200', label: '200まで（入門・基礎）' },
        { value: '300', label: '300まで（実践）' },
      ]);
      const maxLevel = maxLevelChoice ? (Number(maxLevelChoice) as 200 | 300) : undefined;
      const excludeSponsored = (await askChoice<'include' | 'exclude'>('スポンサーセッション（企業提供）は？', [
        { value: 'include', label: '含める' },
        { value: 'exclude', label: '避ける' },
      ])) === 'exclude';
      const earliestStart = (await askChoice<'' | '09:00' | '10:00'>('これより前に始まるセッションは避けたい（時差対策）', [
        { value: '', label: '制限なし' },
        { value: '09:00', label: '9:00より前は避ける' },
        { value: '10:00', label: '10:00より前は避ける' },
      ])) || undefined;
      const lunchBreak = (await askChoice<'no' | 'yes'>('予約するセッションが昼（12:00〜13:00）にかかるとき、警告しますか？（除外はしません）', [
        { value: 'no', label: '警告しない' },
        { value: 'yes', label: '警告する' },
      ])) === 'yes';
      const fixedEvents = await askFixedEvents();

      const answers = { role, purpose, stamina, firstDay, lastDay, interests, themePriority, maxLevel, excludeSponsored, earliestStart, lunchBreak, fixedEvents };
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

function printCatalogDiff(diff: CatalogDiff): void {
  console.log(`新規: ${diff.added.length}件 / 変更: ${diff.changed.length}件 / キャンセル: ${diff.removed.length}件`);
  for (const s of diff.added) console.log(`  + ${s.sessionId} ${s.title}`);
  for (const c of diff.changed) console.log(`  * ${c.sessionId} ${c.after.title} (${c.changedFields.join(', ')})`);
  for (const s of diff.removed) console.log(`  - ${s.sessionId} ${s.title}`);
}

program
  .command('sync')
  .description('カタログ全件を取得し、前回のローカルスナップショットとの差分を表示する')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('--since <date>', '指定日(YYYY-MM-DD)のスナップショットと比較する（例: 1週間前の新着を確認）。省略時は前回保存分と比較')
  .action(async (options: { eventId: string; since?: string }) => {
    const diff = options.since
      ? (await runSyncSince(await createClient(), options.eventId, DATA_DIR, options.since)).diff
      : await runSync(await createClient(), options.eventId, DATA_DIR);
    printCatalogDiff(diff);
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
  .command('view')
  .description('現在のスケジュールとカタログ全件を、タブ付きの1枚のHTML（予定・セッション一覧・全体像・メモ候補）に書き出す（参照専用。予定は変更しない）')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('-d, --date <date>', '「予定」タブをこの日（会場PSTの YYYY-MM-DD）だけにする。省略時は全日')
  .option('--new-since <date>', '「新着」の比較元にするスナップショットの日付（YYYY-MM-DD）。省略時は今日より前で最新の日付')
  .option('-o, --out <file>', '出力先', SCHEDULE_HTML_PATH)
  .action(async (options: { eventId: string; date?: string; newSince?: string; out: string }) => {
    const snapshot = loadSnapshot(options.eventId, DATA_DIR);
    if (!snapshot) throw new Error(`ローカルスナップショット（${options.eventId}）がありません。先に sync を実行してください`);
    const result = await runScheduleView(await createClient(), options.eventId, {
      snapshot, outPath: options.out, profile: loadProfile(PROFILE_PATH), date: options.date,
      dataDir: DATA_DIR, newSince: options.newSince,
    });
    console.log(`保存しました: ${result.path}（予約 ${result.reserved}件 / お気に入り ${result.favorites}件 / 個人予定 ${result.personalTime}件）`);
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

      if (!hasPlanChanges(plan)) {
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

      const backupPath = saveScheduleBackup(options.eventId, before, DATA_DIR);
      console.log(`実行前の予約・お気に入りを保存しました: ${backupPath}`);

      const result = await executeReconcilePlan(client, options.eventId, plan);
      printBulkStep('予約', result.reserve);
      printBulkStep('お気に入り', result.favorite);
      printItemStep('予約解除', result.cancelReservation);
      printItemStep('お気に入り解除', result.unfavorite);

      // 企画書 §5.9: 実行後に必ずGetScheduleで実際の状態を取り直し、意図と突き合わせる
      const verify = await verifyAfterApply(client, options.eventId, desired);
      // 例外は StepResult に変換されて最上位 catch に届かないため、ここで終了コードを立てる
      if (hasApplyFailure(result) || 'reconcileError' in verify) process.exitCode = 1;
      if ('reconcileError' in verify) {
        console.log('実行後の状態を確認できませんでした。');
        for (const line of formatRoadieErrorForCli(verify.reconcileError)) console.log(`  ${line}`);
      } else {
        const remaining = verify.remainingPlan;
        const stillHasChanges = [remaining.toReserve, remaining.toCancelReservation, remaining.toFavorite, remaining.toUnfavorite].some((l) => l.length > 0);
        console.log(stillHasChanges
          ? '一部が意図と一致していません。再度 apply を実行してください（部分失敗は自動では再試行しません）。'
          : '現在の状態は意図と一致しています。');
      }
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
      const plan = buildTravelBlockPlan(schedule, snapshot);

      if (plan.missingSessionIds.length > 0) {
        console.log(`警告: ローカルスナップショットに無いセッションがあります（先に sync を実行してください）: ${plan.missingSessionIds.join(', ')}`);
      }
      for (const blk of plan.insufficientBlocks) {
        console.log(`⚠ ${blk.from.sessionId} → ${blk.to.sessionId}: 移動時間が不足（必要${blk.result.requiredMinutes}分 / 空き${blk.result.availableMinutes}分）`);
      }

      if (plan.candidates.length === 0) {
        console.log('新規に確保すべき移動時間はありません。');
        return;
      }

      console.log('これから確保する移動時間：');
      for (const blk of plan.candidates) {
        const pt = blk.result.personalTime!;
        console.log(`  ${pt.startDateTime} - ${pt.endDateTime}  ${pt.title}`);
      }

      if (!options.yes && !(await askConfirmation('実行しますか？'))) {
        console.log('キャンセルしました。');
        return;
      }

      const count = await applyTravelBlocks(client, options.eventId, plan.candidates);
      console.log(`${count}件の移動時間を確保しました。`);
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
    const personalTimeConflicts = findPersonalTimeConflicts(reservedSessions, schedule.personalTime);
    if (groups.length === 0 && personalTimeConflicts.length === 0) {
      console.log('時間が重複している予約はありません。');
      return;
    }

    for (const c of personalTimeConflicts) {
      console.log(`${c.sessionId} が個人予定「${c.personalTimeTitle}」（${c.startDateTime}〜${c.endDateTime} UTC）と重なっています。`);
    }
    if (personalTimeConflicts.length > 0) console.log('');

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
      const reminders = buildNoteReminderPlan(allNotes, snapshot, schedule);

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

      const count = await applyNoteReminders(client, options.eventId, reminders);
      console.log(`${count}件のリマインダーを確保しました。`);
    } finally {
      closePrompter();
    }
  });

const auth = program.command('auth').description('Builder ID サインインの状態管理');
auth
  .command('status')
  .description('サインイン状態を表示する')
  .action(async () => {
    const status = await runAuthStatus(getTokenStore());
    if (status.signedIn) {
      console.log(`サインイン済み（有効期限: ${status.expiresAt}${status.refreshed ? '、refresh tokenで更新しました' : ''}）`);
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

program
  .command('watch')
  .description('カタログを取得し、満席だったお気に入り（と再演）の空席表示・プロフィールに合う新着・予約とお気に入りの変更と取消を知らせる（予約はしない）')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('--interval <minutes>', '指定した分ごとに繰り返す（5分以上の整数）。省略時は1回だけ確認して終了する')
  .option('--notify', 'macOS のデスクトップ通知も出す（macOS 以外ではコンソール表示のみ）', false)
  .action(async (options: { eventId: string; interval?: string; notify: boolean }) => {
    const intervalMinutes = options.interval === undefined ? undefined : parseIntervalMinutes(options.interval);
    if (options.notify && process.platform !== 'darwin') {
      console.warn('警告: --notify は macOS のみ対応です。コンソール表示のみにします。');
    }

    const tick = async (): Promise<void> => {
      const client = await createClient(); // 毎回呼ぶ（アクセストークンの自動更新のため）
      const result = await runWatchOnce(client, options.eventId, DATA_DIR, loadProfile(PROFILE_PATH));
      const stamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
      for (const line of formatWatchReport(result, stamp)) console.log(line);
      if (options.notify && result.events.length > 0) {
        await notifyDesktop('re:Roadie: 空席・新着の通知', summarizeForNotification(formatWatchEvents(result.events)));
      }
    };

    if (intervalMinutes === undefined) {
      await tick();
      return;
    }
    console.log(`${intervalMinutes}分ごとに確認します。終了は Ctrl+C。`);
    await runWatchLoop({
      tick,
      intervalMs: intervalMinutes * 60_000,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isFatal: (err) => toRoadieError(err).kind === 'authExpired',
      onError: (err) => { for (const line of formatRoadieErrorForCli(toRoadieError(err))) console.error(line); },
    });
  });

program
  .command('now')
  .description('いまから間に合うセッションを出す（開始が移動時間のあとで、予約・個人予定と重ならず、満席表示でないもの）。予約はしない')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('--at <time>', '現地時刻を指定する（"YYYY-MM-DD HH:MM"、会場の時刻）。省略時は現在時刻')
  .option('--venue <venue>', '現在いる会場。省略時は、開催中または直近に終わった予約の会場')
  .option('--within <minutes>', 'この分数以内に始まるものに絞る', '90')
  .option('--limit <n>', '表示する件数', '10')
  .action(async (options: { eventId: string; at?: string; venue?: string; within: string; limit: string }) => {
    const now = options.at === undefined ? undefined : parseVenueLocalTime(options.at);
    if (options.at !== undefined && !now) throw new Error(`--at は "YYYY-MM-DD HH:MM" の形で指定してください: "${options.at}"`);
    const client = await createClient();
    const result = await runNowGo(client, options.eventId, DATA_DIR, loadProfile(PROFILE_PATH), {
      now, venue: options.venue, withinMinutes: Number(options.within), limit: Number(options.limit),
    });
    for (const line of formatNowGo(result)) console.log(line);
  });

program
  .command('forecast')
  .description('空席表示の履歴から、近いうちに埋まりそうなセッションと穴場を出す（見積もり。予約はしない）')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('--horizon <days>', 'この日数以内に満席になる見込みのものを出す', '14')
  .option('--limit <n>', '区分ごとの表示件数', '10')
  .action(async (options: { eventId: string; horizon: string; limit: string }) => {
    const client = await createClient();
    const result = await runSeatForecast(client, options.eventId, DATA_DIR, loadProfile(PROFILE_PATH), {
      horizonDays: Number(options.horizon), limit: Number(options.limit),
    });
    for (const line of formatForecast(result)) console.log(line);
  });

program
  .command('detour')
  .description('予約の合間に収まる、関心の外のセッション（寄り道）を日ごとに提案する。予約はしない')
  .option('-e, --event-id <eventId>', 'イベントID', DEFAULT_EVENT_ID)
  .option('-d, --date <dates...>', '会場の日付 YYYY-MM-DD（複数可）。省略時は予約のある日')
  .option('--per-day <n>', '1日あたりの候補数', '3')
  .action(async (options: { eventId: string; date?: string[]; perDay: string }) => {
    const client = await createClient();
    const result = await runDetour(client, options.eventId, DATA_DIR, loadProfile(PROFILE_PATH), {
      dates: options.date, perDay: Number(options.perDay),
    });
    for (const line of formatDetours(result)) console.log(line);
  });

program
  .command('mcp')
  .description('MCPサーバーとして起動する（stdio）。Claude Desktop等のMCPクライアントから利用する')
  .action(async () => {
    await startMcpServer();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  for (const line of formatRoadieErrorForCli(toRoadieError(err))) console.error(line);
  closePrompter();
  process.exitCode = 1;
});

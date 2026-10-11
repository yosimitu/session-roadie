import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SessionBrief, WatchEvent, WatchRole } from '../catalog/watch.js';
import type { WatchResult } from './watch.js';

const ROLE_LABEL: Record<WatchRole, string> = { reserved: '予約', favorite: 'お気に入り' };

function label(s: SessionBrief): string {
  return `${s.abbreviation ?? s.sessionId} ${s.title}`;
}

function when(s: SessionBrief): string {
  const date = s.date?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const day = date ? `${Number(date[1])}/${Number(date[2])}` : s.date;
  return [day, s.time].filter(Boolean).join(' ');
}

function where(s: SessionBrief): string {
  const parts = [when(s), s.venue].filter(Boolean);
  return parts.length > 0 ? `（${parts.join('、')}）` : '';
}

export function formatWatchEvent(e: WatchEvent): string {
  switch (e.kind) {
    case 'seatOpened':
      return `空席表示が変わりました（予約できるとは限りません）: ${label(e.session)}${where(e.session)} [${e.session.seat}]`;
    case 'altSeatOpened':
      return `満席の ${e.forSession.abbreviation ?? e.forSession.sessionId} の再演に空席表示（予約できるとは限りません）: ${label(e.session)}${where(e.session)} [${e.session.seat}]`;
    case 'newMatching':
      return `新着: ${label(e.session)}${where(e.session)}`;
    case 'changedMine':
      return `変更（${ROLE_LABEL[e.role]}）: ${label(e.session)}${where(e.session)} ${e.changedFields.join(', ')}`;
    case 'removedMine':
      return `取消（${ROLE_LABEL[e.role]}）: ${label(e.session)}${where(e.session)}`;
  }
}

export function formatWatchEvents(events: WatchEvent[]): string[] {
  return events.map(formatWatchEvent);
}

/** 1回の確認の結果を、表示する行にする。stamp は "HH:MM:SS" */
export function formatWatchReport(result: WatchResult, stamp: string): string[] {
  if (result.status === 'empty') return [`[${stamp}] カタログが空です（ListSessions が0件）。状態は更新しません。`];
  if (result.status === 'shrunk') return [`[${stamp}] 取得件数が前回の半分未満です（${result.sessionCount}件）。部分的な応答の可能性があるため、状態は更新しません。`];
  if (result.status === 'baseline') return [`[${stamp}] 監視の基準を保存しました（${result.sessionCount}件）。次回から変化を知らせます。`];
  if (result.events.length === 0) return [`[${stamp}] 変化はありません（${result.sessionCount}件）。`];
  return [`[${stamp}] ${result.events.length}件の変化:`, ...formatWatchEvents(result.events).map((l) => `  ${l}`)];
}

const NOTIFICATION_MAX_LENGTH = 200;

export function summarizeForNotification(lines: string[]): string {
  const first = lines[0] ?? '';
  const text = lines.length > 1 ? `${first} ほか${lines.length - 1}件` : first;
  return text.length > NOTIFICATION_MAX_LENGTH ? text.slice(0, NOTIFICATION_MAX_LENGTH) : text;
}

export type CommandRunner = (file: string, args: string[]) => Promise<void>;

const execFileAsync = promisify(execFile);
const defaultRun: CommandRunner = async (file, args) => { await execFileAsync(file, args, { timeout: 10_000 }); };

/**
 * macOS のデスクトップ通知。本文と題は osascript の引数として渡し、スクリプトの文字列には埋め込まない
 * （引用符やバックスラッシュを含んでも、スクリプトの書き換えにならない）。
 * macOS 以外では何もせず false を返す。
 */
export async function notifyDesktop(
  title: string,
  message: string,
  options: { platform?: NodeJS.Platform; run?: CommandRunner } = {},
): Promise<boolean> {
  if ((options.platform ?? process.platform) !== 'darwin') return false;
  const run = options.run ?? defaultRun;
  await run('osascript', [
    '-e', 'on run argv',
    '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
    '-e', 'end run',
    message, title,
  ]);
  return true;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SessionBrief, WatchEvent, WatchRole } from '../catalog/watch.js';
import type { Session } from '../api/types.js';
import { isSponsored } from '../catalog/search.js';
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

const NEW_SESSIONS_TOP = 3;
const NEW_SESSION_TITLE_MAX = 40;

function shortLabel(s: SessionBrief): string {
  const title = s.title.length > NEW_SESSION_TITLE_MAX ? `${s.title.slice(0, NEW_SESSION_TITLE_MAX)}…` : s.title;
  return `${s.abbreviation ?? s.sessionId} ${title}`;
}

const sponsored = (s: SessionBrief) => isSponsored(s as Session);

/** カタログの新着の通知文。プロフィールに合うものを先に、スポンサー枠は後ろに、残りは日時順で上位数件を並べる。新着が無ければ null */
export function summarizeNewSessions(result: WatchResult, top = NEW_SESSIONS_TOP): string | null {
  const added = result.newSessions ?? [];
  if (added.length === 0) return null;
  const matching = new Set(result.events.flatMap((e) => (e.kind === 'newMatching' ? [e.session.sessionId] : [])));
  const startsAt = (s: SessionBrief) => `${s.date ?? ''} ${s.time ?? ''}`;
  const ranked = [...added].sort(
    (a, b) =>
      Number(sponsored(a)) - Number(sponsored(b)) ||
      Number(matching.has(b.sessionId)) - Number(matching.has(a.sessionId)) ||
      startsAt(a).localeCompare(startsAt(b)),
  );
  const text = `新着${added.length}件: ${ranked.slice(0, top).map(shortLabel).join(' / ')}${added.length > top ? ` ほか${added.length - top}件` : ''}`;
  return text;
}

export type CommandRunner = (file: string, args: string[], env?: Record<string, string>) => Promise<void>;

const execFileAsync = promisify(execFile);
const defaultRun: CommandRunner = async (file, args, env) => {
  await execFileAsync(file, args, { timeout: 10_000, env: env ? { ...process.env, ...env } : process.env });
};

// Windows のトースト通知（Windows PowerShell 5.1）。題と本文は環境変数で渡し、XML のテキストノードとして入れる
// （引用符や記号を含んでも、スクリプトや XML の書き換えにならない）。送り元には、通知が受け付けられやすい
// Windows PowerShell 自身の AppUserModelID を使う。
const WINDOWS_TOAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode($env:ROADIE_NOTIFY_TITLE)) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode($env:ROADIE_NOTIFY_MESSAGE)) | Out-Null
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

/**
 * デスクトップ通知。macOS は osascript、Windows は PowerShell のトースト通知を使う。
 * どちらも、本文と題はスクリプトの文字列に埋め込まず、引数か環境変数で渡す。
 * それ以外の OS では何もせず false を返す。
 */
export async function notifyDesktop(
  title: string,
  message: string,
  options: { platform?: NodeJS.Platform; run?: CommandRunner } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRun;
  if (platform === 'darwin') {
    await run('osascript', [
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run',
      message, title,
    ]);
    return true;
  }
  if (platform === 'win32') {
    const encoded = Buffer.from(WINDOWS_TOAST_SCRIPT, 'utf16le').toString('base64');
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { ROADIE_NOTIFY_TITLE: title, ROADIE_NOTIFY_MESSAGE: message },
    );
    return true;
  }
  return false;
}

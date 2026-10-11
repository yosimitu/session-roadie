// 同じ全件取得を短い間隔で繰り返すと、クォータ（ListSessions 120回/分）と先方への負荷が増えるので、最短を決めておく。
export const MIN_INTERVAL_MINUTES = 5;

export function parseIntervalMinutes(value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isInteger(n) || n < MIN_INTERVAL_MINUTES) {
    throw new Error(`--interval は${MIN_INTERVAL_MINUTES}分以上の整数（分）で指定してください: "${value}"`);
  }
  return n;
}

export interface WatchLoopOptions {
  tick: () => Promise<void>;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  /** true を返したエラーは、ループを止めて投げ直す（例: 認証切れ） */
  isFatal: (err: unknown) => boolean;
  /** 致命的でないエラーの扱い（表示して次回に再試行する） */
  onError: (err: unknown) => void;
  /** テスト用。省略時は無限に繰り返す */
  maxTicks?: number;
}

export async function runWatchLoop(options: WatchLoopOptions): Promise<void> {
  for (let i = 0; options.maxTicks === undefined || i < options.maxTicks; i += 1) {
    try {
      await options.tick();
    } catch (err) {
      if (options.isFatal(err)) throw err;
      options.onError(err);
    }
    if (options.maxTicks !== undefined && i + 1 >= options.maxTicks) return;
    await options.sleep(options.intervalMs);
  }
}

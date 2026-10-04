import { join } from 'node:path';
import { ApiClient } from './api/client.js';
import { TokenStore } from './auth/tokenStore.js';
import { ensureAccessToken } from './auth/signIn.js';

// CLI（src/cli.ts）とMCPサーバー（src/mcp/server.ts）の両方から使う共通設定。
// データはすべて `<カレントディレクトリ>/data` 配下に保存する（企画書: ローカル保存のみ、再配布しない）。
export const DEFAULT_EVENT_ID = 'reinvent2026';
export const DATA_DIR = join(process.cwd(), 'data');
export const NOTES_PATH = join(DATA_DIR, 'notes.yaml');
export const PROFILE_PATH = join(DATA_DIR, 'profile.yaml');
export const INTENT_PATH = join(DATA_DIR, 'intent.txt');

export function getTokenStore(): TokenStore {
  return new TokenStore(join(DATA_DIR, 'token.json'));
}

/**
 * 401対策（企画書 §5.9と同じ「必ず最新状態を取り直す」思想）として、呼び出し前に一度だけ
 * ensureAccessTokenでリフレッシュを試みる。ApiClientのgetAccessTokenは同期関数のため、
 * 取得した値をクロージャで固定して渡す。
 */
export async function createClient(): Promise<ApiClient> {
  const tokenStore = getTokenStore();
  const accessToken = await ensureAccessToken(tokenStore);
  return new ApiClient({ getAccessToken: () => accessToken });
}

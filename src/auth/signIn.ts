import open from 'open';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { startLoopbackServer } from './loopbackServer.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeRefreshToken,
  buildSignOutUrl,
  type TokenResponse,
} from './builderIdAuth.js';
import { TokenStore, type StoredToken } from './tokenStore.js';
import { DEFAULT_LOOPBACK_PORT, logoutUriFor } from './constants.js';

const DEFAULT_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export interface AuthFlowOptions {
  /** ブラウザでURLを開く処理。省略時は `open` パッケージで実際のブラウザを開く。テストでは差し替える。 */
  openUrl?: (url: string) => Promise<void>;
  /** ブラウザでの操作を待つ上限（ミリ秒）。省略時は5分。 */
  timeoutMs?: number;
}

function defaultOpenUrl(url: string): Promise<void> {
  return open(url).then(() => undefined);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('サインインがタイムアウトしました。ブラウザでの操作を確認し、もう一度お試しください。')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function toStoredToken(token: TokenResponse, fallbackRefreshToken?: string): StoredToken {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? fallbackRefreshToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
  };
}

/**
 * Builder IDでサインインする（企画書 §9「Builder IDのauthorize/tokenエンドポイントとscopeの実値」への回答）。
 * ループバックサーバーでコールバックを受け、認可コードをトークンに交換してTokenStoreへ保存する。
 */
export async function signIn(tokenStore: TokenStore, options: AuthFlowOptions = {}): Promise<StoredToken> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const server = await startLoopbackServer();
  const openUrl = options.openUrl ?? defaultOpenUrl;

  try {
    const authorizationUrl = buildAuthorizationUrl({ redirectUri: server.redirectUri, codeChallenge, state });
    const callbackPromise = server.waitForCallback();
    await openUrl(authorizationUrl);

    const result = await withTimeout(callbackPromise, options.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS);
    if ('error' in result) {
      throw new Error(`サインインが拒否されました: ${result.error}${result.errorDescription ? `（${result.errorDescription}）` : ''}`);
    }
    if (result.state !== state) {
      throw new Error('stateが一致しません。CSRFの可能性があるため中断しました。もう一度サインインしてください。');
    }

    const tokenResponse = await exchangeCodeForToken({ redirectUri: server.redirectUri, code: result.code, codeVerifier });
    const stored = toStoredToken(tokenResponse);
    tokenStore.save(stored);
    return stored;
  } finally {
    server.close();
  }
}

/**
 * APIが401を返したときの立て直しに使う（企画書 §5.9 と同じ「必ず最新状態を取り直す」思想）。
 * 有効なアクセストークンがあればそれを、期限切れでもrefresh tokenがあれば更新して返す。
 * どちらも無理なら undefined（signInでの再サインインが必要）。
 */
export async function ensureAccessToken(tokenStore: TokenStore): Promise<string | undefined> {
  const valid = tokenStore.load();
  if (valid) return valid.accessToken;

  const raw = tokenStore.loadRaw();
  if (!raw?.refreshToken) return undefined;

  try {
    const refreshed = await refreshAccessToken(raw.refreshToken);
    const stored = toStoredToken(refreshed, raw.refreshToken);
    tokenStore.save(stored);
    return stored.accessToken;
  } catch {
    // refresh tokenが失効している。再サインインが必要（ループで再試行しない）。
    return undefined;
  }
}

/**
 * サインアウトする（企画書: トークン破棄だけでは不十分。revoke→ローカル削除→Builder IDセッション終了の順）。
 */
export async function signOut(tokenStore: TokenStore, options: AuthFlowOptions = {}): Promise<void> {
  const raw = tokenStore.loadRaw();
  if (raw?.refreshToken) {
    await revokeRefreshToken(raw.refreshToken).catch(() => undefined);
  }
  tokenStore.clear();

  const openUrl = options.openUrl ?? defaultOpenUrl;
  const signOutUrl = buildSignOutUrl(logoutUriFor(DEFAULT_LOOPBACK_PORT));
  await openUrl(signOutUrl);
}

import {
  AUTHORIZATION_ENDPOINT,
  TOKEN_ENDPOINT,
  REVOCATION_ENDPOINT,
  APP_LOGOUT_ENDPOINT,
  BUILDER_ID_SIGN_OUT_ENDPOINT,
  CLIENT_ID,
  SCOPE,
  IDENTITY_PROVIDER,
} from './constants.js';

// 出典: https://docs.aws.amazon.com/events/latest/devguide/auth-signing-in.html
//       https://docs.aws.amazon.com/events/latest/devguide/auth-refreshing.html
//       https://docs.aws.amazon.com/events/latest/devguide/auth-signing-out.html
// （いずれも 2026-10-01 取得）

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number; // 秒
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

function toTokenResponse(raw: RawTokenResponse): TokenResponse {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    idToken: raw.id_token,
    expiresIn: raw.expires_in,
  };
}

async function postForm(url: string, params: Record<string, string>): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return res;
}

export function buildAuthorizationUrl(options: { redirectUri: string; codeChallenge: string; state: string }): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: options.redirectUri,
    scope: SCOPE,
    identity_provider: IDENTITY_PROVIDER,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    state: options.state,
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForToken(options: { redirectUri: string; code: string; codeVerifier: string }): Promise<TokenResponse> {
  const res = await postForm(TOKEN_ENDPOINT, {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: options.redirectUri,
    code: options.code,
    code_verifier: options.codeVerifier,
  });
  if (!res.ok) throw new Error(`トークン交換に失敗しました（HTTP ${res.status}）: ${await res.text()}`);
  return toTokenResponse((await res.json()) as RawTokenResponse);
}

/** 企画書 §4「401は1回だけrefreshしてretry」の前提になる、refresh_tokenグラント */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await postForm(TOKEN_ENDPOINT, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
  if (!res.ok) throw new Error(`トークン更新に失敗しました（HTTP ${res.status}）: ${await res.text()}`);
  return toTokenResponse((await res.json()) as RawTokenResponse);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const res = await postForm(REVOCATION_ENDPOINT, { client_id: CLIENT_ID, token: refreshToken });
  if (!res.ok) throw new Error(`トークン失効に失敗しました（HTTP ${res.status}）: ${await res.text()}`);
}

/**
 * サインアウトの2段階URL（企画書: Builder IDのログアウトを先に経由させないと、
 * 見た目だけサインアウトしてプロンプト無しで再サインインされる）。
 * 内側: oauth.awsevents.com/logout（ブローカーのセッションを終了しアプリへ戻す）
 * 外側: idp.awsevents.com/oidc/logout（Builder ID自体のセッションを終了）
 */
export function buildSignOutUrl(logoutUri: string): string {
  const innerParams = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: logoutUri });
  const innerUrl = `${APP_LOGOUT_ENDPOINT}?${innerParams.toString()}`;
  return `${BUILDER_ID_SIGN_OUT_ENDPOINT}?redirect_uri=${encodeURIComponent(innerUrl)}`;
}

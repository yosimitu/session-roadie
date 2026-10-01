import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeRefreshToken,
  buildSignOutUrl,
} from '../../src/auth/builderIdAuth.js';

describe('buildAuthorizationUrl', () => {
  it('authorizeエンドポイントに必須パラメータを全て含める（企画書 §9 で確認したエンドポイント仕様）', () => {
    const url = buildAuthorizationUrl({
      redirectUri: 'http://localhost:8484/callback',
      codeChallenge: 'CHALLENGE',
      state: 'STATE',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://oauth.awsevents.com/oauth2/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('7vmom55m1qstvq8i71ph127bfq');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:8484/callback');
    expect(parsed.searchParams.get('scope')).toBe('openid email events/access');
    expect(parsed.searchParams.get('identity_provider')).toBe('AWSBuilderID');
    expect(parsed.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('STATE');
  });
});

describe('exchangeCodeForToken', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('tokenエンドポイントにauthorization_codeグラントでPOSTし、レスポンスを正規化する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', id_token: 'it', expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const token = await exchangeCodeForToken({ redirectUri: 'http://localhost:8484/callback', code: 'CODE', codeVerifier: 'VERIFIER' });

    expect(token).toEqual({ accessToken: 'at', refreshToken: 'rt', idToken: 'it', expiresIn: 3600 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth.awsevents.com/oauth2/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('7vmom55m1qstvq8i71ph127bfq');
    expect(body.get('redirect_uri')).toBe('http://localhost:8484/callback');
    expect(body.get('code')).toBe('CODE');
    expect(body.get('code_verifier')).toBe('VERIFIER');
  });

  it('非200応答は例外を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(exchangeCodeForToken({ redirectUri: 'http://localhost:8484/callback', code: 'bad', codeVerifier: 'v' })).rejects.toThrow();
  });
});

describe('refreshAccessToken', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refresh_tokenグラントでPOSTする', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'new-at', expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const token = await refreshAccessToken('OLD_REFRESH');

    expect(token.accessToken).toBe('new-at');
    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('OLD_REFRESH');
  });

  it('新しいrefresh_tokenが返らない場合はundefinedのまま（元のトークンを使い続ける判断は呼び出し側）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'new-at', expires_in: 3600 }), { status: 200 })));
    const token = await refreshAccessToken('OLD_REFRESH');
    expect(token.refreshToken).toBeUndefined();
  });
});

describe('revokeRefreshToken', () => {
  it('revokeエンドポイントにPOSTする', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeRefreshToken('RT');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth.awsevents.com/oauth2/revoke');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('token')).toBe('RT');
  });
});

describe('buildSignOutUrl', () => {
  it('Builder IDのログアウトエンドポイントを先頭にした2段階URLを組み立てる（企画書: 順序が重要）', () => {
    const url = buildSignOutUrl('http://localhost:8484/logout');
    expect(url.startsWith('https://idp.awsevents.com/oidc/logout?redirect_uri=')).toBe(true);

    const inner = decodeURIComponent(url.split('redirect_uri=')[1]);
    const innerUrl = new URL(inner);
    expect(innerUrl.origin + innerUrl.pathname).toBe('https://oauth.awsevents.com/logout');
    expect(innerUrl.searchParams.get('logout_uri')).toBe('http://localhost:8484/logout');
  });
});

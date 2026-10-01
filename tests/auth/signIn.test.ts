import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../../src/auth/tokenStore.js';
import { signIn, ensureAccessToken, signOut } from '../../src/auth/signIn.js';

describe('signIn', () => {
  let dir: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'night-shift-signin-'));
    originalFetch = global.fetch;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('認可URLを開き、コールバックのcodeをトークンに交換して保存する', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('oauth.awsevents.com/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 });
      }
      return originalFetch(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokenStore = new TokenStore(join(dir, 'token.json'));
    const openUrl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      const state = parsed.searchParams.get('state')!;
      await fetch(`${redirectUri}?code=AUTHCODE&state=${state}`);
    });

    const result = await signIn(tokenStore, { openUrl });

    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
    expect(tokenStore.load()?.accessToken).toBe('at');
  });

  it('認可サーバーがerrorを返したら例外を投げ、トークンを保存しない', async () => {
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    const openUrl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?error=access_denied`);
    });

    await expect(signIn(tokenStore, { openUrl })).rejects.toThrow(/access_denied/);
    expect(tokenStore.load()).toBeUndefined();
  });

  it('stateが一致しなければ例外を投げる（CSRF対策）', async () => {
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    const openUrl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=AUTHCODE&state=WRONG_STATE`);
    });

    await expect(signIn(tokenStore, { openUrl })).rejects.toThrow(/state/);
  });

  it('ブラウザでの操作が無いままタイムアウトしたら例外を投げる', async () => {
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    const openUrl = vi.fn(async () => undefined); // コールバックを一切起こさない

    await expect(signIn(tokenStore, { openUrl, timeoutMs: 20 })).rejects.toThrow(/タイムアウト/);
  });
});

describe('ensureAccessToken', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-ensure-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it('有効なトークンがあればそのまま返す', async () => {
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    tokenStore.save({ accessToken: 'at', expiresAt: Date.now() + 3600_000 });
    expect(await ensureAccessToken(tokenStore)).toBe('at');
  });

  it('期限切れだがrefreshTokenがあればリフレッシュして保存し直す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'new-at', expires_in: 3600 }), { status: 200 })));
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    tokenStore.save({ accessToken: 'old-at', refreshToken: 'rt', expiresAt: Date.now() - 1000 });

    const token = await ensureAccessToken(tokenStore);

    expect(token).toBe('new-at');
    expect(tokenStore.load()?.accessToken).toBe('new-at');
    expect(tokenStore.load()?.refreshToken).toBe('rt');
  });

  it('期限切れでrefreshTokenも無ければundefinedを返す（再サインインが必要）', async () => {
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    tokenStore.save({ accessToken: 'old-at', expiresAt: Date.now() - 1000 });
    expect(await ensureAccessToken(tokenStore)).toBeUndefined();
  });

  it('リフレッシュが失敗（refresh token失効）したらundefinedを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    tokenStore.save({ accessToken: 'old-at', refreshToken: 'expired-rt', expiresAt: Date.now() - 1000 });
    expect(await ensureAccessToken(tokenStore)).toBeUndefined();
  });
});

describe('signOut', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-signout-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it('refreshTokenを失効させ、ローカルのトークンを削除する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    tokenStore.save({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });
    const openUrl = vi.fn();

    await signOut(tokenStore, { openUrl });

    expect(tokenStore.loadRaw()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://oauth.awsevents.com/oauth2/revoke', expect.anything());
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining('https://idp.awsevents.com/oidc/logout'));
  });

  it('トークンが無くても例外を投げない', async () => {
    const tokenStore = new TokenStore(join(dir, 'token.json'));
    const openUrl = vi.fn();
    await expect(signOut(tokenStore, { openUrl })).resolves.not.toThrow();
  });
});

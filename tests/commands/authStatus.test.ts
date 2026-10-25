import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../../src/auth/tokenStore.js';
import { runAuthStatus } from '../../src/commands/authStatus.js';

describe('runAuthStatus', () => {
  let dir: string;
  let store: TokenStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'night-shift-authstatus-'));
    store = new TokenStore(join(dir, 'token.json'));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('トークンが無ければsignedIn: falseを返し、更新を試みない', async () => {
    const refresh = vi.fn();
    expect(await runAuthStatus(store, refresh)).toEqual({ signedIn: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('有効なトークンがあればsignedIn: trueとISO8601の有効期限を返す', async () => {
    const expiresAt = Date.now() + 3600_000;
    store.save({ accessToken: 'abc', expiresAt });
    expect(await runAuthStatus(store, vi.fn())).toEqual({ signedIn: true, expiresAt: new Date(expiresAt).toISOString() });
  });

  it('アクセストークンに email があれば、サインイン中のアカウントとして返す', async () => {
    const expiresAt = Date.now() + 3600_000;
    const accessToken = ['h', Buffer.from(JSON.stringify({ email: 'me@example.com' })).toString('base64url'), 's'].join('.');
    store.save({ accessToken, expiresAt });
    expect(await runAuthStatus(store, vi.fn())).toEqual({ signedIn: true, email: 'me@example.com', expiresAt: new Date(expiresAt).toISOString() });
  });

  it('アクセストークン期限切れでもrefresh tokenで更新できればsignedIn: true（refreshed: true）', async () => {
    store.save({ accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() - 1000 });
    const newExpiresAt = Date.now() + 3600_000;
    const refresh = vi.fn(async (s: TokenStore) => {
      s.save({ accessToken: 'new', refreshToken: 'rt', expiresAt: newExpiresAt });
      return 'new';
    });

    expect(await runAuthStatus(store, refresh)).toEqual({
      signedIn: true,
      expiresAt: new Date(newExpiresAt).toISOString(),
      refreshed: true,
    });
  });

  it('refresh tokenも失効していればsignedIn: false', async () => {
    store.save({ accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() - 1000 });
    expect(await runAuthStatus(store, vi.fn(async () => undefined))).toEqual({ signedIn: false });
  });

  it('期限切れでrefresh tokenが無ければ更新を試みずsignedIn: false', async () => {
    store.save({ accessToken: 'old', expiresAt: Date.now() - 1000 });
    const refresh = vi.fn();
    expect(await runAuthStatus(store, refresh)).toEqual({ signedIn: false });
    expect(refresh).not.toHaveBeenCalled();
  });
});

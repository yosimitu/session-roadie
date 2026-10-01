import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../../src/auth/tokenStore.js';
import { runAuthStatus } from '../../src/commands/authStatus.js';

describe('runAuthStatus', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-authstatus-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('トークンが無ければsignedIn: falseを返す', () => {
    const store = new TokenStore(join(dir, 'token.json'));
    expect(runAuthStatus(store)).toEqual({ signedIn: false });
  });

  it('有効なトークンがあればsignedIn: trueと有効期限を返す', () => {
    const store = new TokenStore(join(dir, 'token.json'));
    const expiresAt = Date.now() + 3600_000;
    store.save({ accessToken: 'abc', expiresAt });
    expect(runAuthStatus(store)).toEqual({ signedIn: true, expiresAt });
  });
});

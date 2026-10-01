import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../../src/auth/tokenStore.js';

describe('TokenStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('保存したトークンを読み込める', () => {
    const store = new TokenStore(join(dir, 'token.json'));
    store.save({ accessToken: 'abc', expiresAt: Date.now() + 3600_000 });
    const loaded = store.load();
    expect(loaded?.accessToken).toBe('abc');
  });

  it('期限切れトークンはundefinedを返す', () => {
    const store = new TokenStore(join(dir, 'token.json'));
    store.save({ accessToken: 'abc', expiresAt: Date.now() - 1000 });
    expect(store.load()).toBeUndefined();
  });

  it('ファイルが無ければundefinedを返す', () => {
    const store = new TokenStore(join(dir, 'missing.json'));
    expect(store.load()).toBeUndefined();
  });
});

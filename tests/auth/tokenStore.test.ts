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

  it('loadRawは期限切れでもrefreshTokenを読める（access tokenの期限切れ後もrefresh tokenは30日有効なため）', () => {
    const store = new TokenStore(join(dir, 'token.json'));
    store.save({ accessToken: 'abc', refreshToken: 'rt', expiresAt: Date.now() - 1000 });
    expect(store.loadRaw()?.refreshToken).toBe('rt');
  });

  it('clearでファイルを削除する（二重削除してもエラーにしない）', () => {
    const store = new TokenStore(join(dir, 'token.json'));
    store.save({ accessToken: 'abc', expiresAt: Date.now() + 3600_000 });
    store.clear();
    expect(store.load()).toBeUndefined();
    expect(() => store.clear()).not.toThrow();
  });
});

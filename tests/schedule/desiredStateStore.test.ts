import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDesiredState } from '../../src/schedule/desiredStateStore.js';

describe('loadDesiredState', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-desired-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('JSONを読み込んでDesiredStateにする', () => {
    const path = join(dir, 'desired.json');
    writeFileSync(path, JSON.stringify({ reserve: ['s1'], favorite: ['s2'] }));
    expect(loadDesiredState(path)).toEqual({ reserve: ['s1'], favorite: ['s2'] });
  });

  it('reserve/favoriteが欠けていればundefined（現状維持）のままにする', () => {
    const path = join(dir, 'desired.json');
    writeFileSync(path, JSON.stringify({ reserve: ['s1'] }));
    expect(loadDesiredState(path)).toEqual({ reserve: ['s1'], favorite: undefined });
  });

  it('ファイルが無ければエラーを投げる（意図ファイルは明示指定が前提のため、無言でからの状態にしない）', () => {
    expect(() => loadDesiredState(join(dir, 'missing.json'))).toThrow();
  });

  it('壊れたJSONもエラーを投げる', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{not json');
    expect(() => loadDesiredState(path)).toThrow();
  });
});

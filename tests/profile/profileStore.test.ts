import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfile } from '../../src/profile/profileStore.js';

describe('loadProfile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'night-shift-profile-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('ファイルが無ければundefinedを返す（プロフィールは任意）', () => {
    expect(loadProfile(join(dir, 'missing.yaml'))).toBeUndefined();
  });

  it('YAMLを読み込んでProfileにする', () => {
    const path = join(dir, 'profile.yaml');
    writeFileSync(path, 'strongTopics: ["Networking"]\nweakTopics: ["Kubernetes"]\n');
    const profile = loadProfile(path);
    expect(profile?.strongTopics).toEqual(['Networking']);
    expect(profile?.weakTopics).toEqual(['Kubernetes']);
  });

  it('壊れたYAMLはundefinedを返し、例外を投げない', () => {
    const path = join(dir, 'broken.yaml');
    writeFileSync(path, 'key: [unterminated');
    expect(() => loadProfile(path)).not.toThrow();
    expect(loadProfile(path)).toBeUndefined();
  });
});

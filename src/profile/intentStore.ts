import { readFileSync, existsSync } from 'node:fs';

export interface Intent {
  freeText?: string; // 自由文の意図。5.1の対話入力もここに正規化して書き込む
}

export function loadIntent(path: string): Intent | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return { freeText: readFileSync(path, 'utf-8').trim() };
  } catch {
    return undefined;
  }
}

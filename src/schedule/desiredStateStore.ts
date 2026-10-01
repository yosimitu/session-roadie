import { readFileSync } from 'node:fs';
import type { DesiredState } from './reconcile.js';

// 「意図」（自由文）を実際に書き込める形（予約したい/お気に入りにしたいセッションID集合）に
// 変換するのは対話・推論側の責務。ここではその結果を受け取るだけで、JSONファイルとして明示的に
// 指定されたものだけを読む（profile/intent/notesと異なり、未指定のまま実行して意図せず
// 「何もかも外す」事故を防ぐため、ファイルが無い/壊れている場合は例外を投げる）。
export function loadDesiredState(path: string): DesiredState {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<DesiredState>;
  return {
    reserve: parsed.reserve ?? [],
    favorite: parsed.favorite ?? [],
  };
}

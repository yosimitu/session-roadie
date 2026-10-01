import type { Session } from '../api/types.js';

// 企画書 §5.6「変化を見張って、勝手に直す」の監視対象: 新規追加・時間/会場変更・キャンセル。
// 「変更」は時間・会場に限定する（abstract等の文言修正まで拾うとノイズになるため）。
const CHANGE_TRACKED_FIELDS = ['venue', 'room', 'sessionTime'] as const;

export interface ChangedSession {
  sessionId: string;
  before: Session;
  after: Session;
  changedFields: string[];
}

export interface CatalogDiff {
  added: Session[];
  removed: Session[];
  changed: ChangedSession[];
}

function fieldChanged(before: Session, after: Session, field: (typeof CHANGE_TRACKED_FIELDS)[number]): boolean {
  return JSON.stringify(before[field]) !== JSON.stringify(after[field]);
}

export function diffCatalog(before: Session[], after: Session[]): CatalogDiff {
  const beforeById = new Map(before.map((s) => [s.sessionId, s]));
  const afterById = new Map(after.map((s) => [s.sessionId, s]));

  const added: Session[] = [];
  const changed: ChangedSession[] = [];
  for (const [sessionId, afterSession] of afterById) {
    const beforeSession = beforeById.get(sessionId);
    if (!beforeSession) {
      added.push(afterSession);
      continue;
    }
    const changedFields = CHANGE_TRACKED_FIELDS.filter((field) => fieldChanged(beforeSession, afterSession, field));
    if (changedFields.length > 0) {
      changed.push({ sessionId, before: beforeSession, after: afterSession, changedFields });
    }
  }

  const removed: Session[] = [];
  for (const [sessionId, beforeSession] of beforeById) {
    if (!afterById.has(sessionId)) removed.push(beforeSession);
  }

  return { added, removed, changed };
}

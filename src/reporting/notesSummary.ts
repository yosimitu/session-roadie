import type { Session } from '../api/types.js';
import type { NotesBySessionId } from '../profile/notesStore.js';

const UNCATEGORIZED_LABEL = 'その他';

/** メモをセッションの最初のtopicでグループ化し、帰国後報告用のMarkdownを作る（企画書 §5.7） */
export function buildNotesSummary(notes: NotesBySessionId, sessions: Session[]): string {
  const entries = Object.entries(notes);
  if (entries.length === 0) return 'メモはありません。';

  const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
  const byTheme = new Map<string, string[]>();

  for (const [sessionId, note] of entries) {
    const session = sessionById.get(sessionId);
    const theme = session?.topics?.[0] ?? UNCATEGORIZED_LABEL;
    const label = session ? session.title : sessionId;
    const list = byTheme.get(theme) ?? [];
    list.push(`${label}: ${note}`);
    byTheme.set(theme, list);
  }

  const themes = [...byTheme.keys()].filter((t) => t !== UNCATEGORIZED_LABEL).sort();
  if (byTheme.has(UNCATEGORIZED_LABEL)) themes.push(UNCATEGORIZED_LABEL);

  return themes.map((theme) => `## ${theme}\n${byTheme.get(theme)!.map((line) => `- ${line}`).join('\n')}`).join('\n\n');
}

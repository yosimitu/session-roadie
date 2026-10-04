import type { Session } from '../api/types.js';

// 企画書 §5.4「諦める判断を支援する」: 判断材料はすべてAPIから取得した事実（再演の有無、
// Speaker一致、トピック一致）であり、AIの主観は使わない。

/**
 * 再演サフィックスを除いたセッション番号（"DAT410-R1" → "DAT410"）。
 * 2026-10-01実データでは "-R"（485件）・"-R1"（436件）・"-R2"以降（9件）が混在し、元番号が存在しない組も多い。
 */
export function baseAbbreviation(abbreviation: string): string {
  return abbreviation.replace(/-R\d*$/, '');
}

/** 同じ元番号を持つ自分以外のセッション（元・-R・-R1… のどれからでも相互に見つける） */
export function findRepeats(sessions: Session[], target: Session): Session[] {
  if (!target.abbreviation) return [];
  const base = baseAbbreviation(target.abbreviation);
  return sessions.filter(
    (s) => s.sessionId !== target.sessionId && s.abbreviation !== undefined && baseAbbreviation(s.abbreviation) === base,
  );
}

export function findRepeat(sessions: Session[], target: Session): Session | undefined {
  return findRepeats(sessions, target)[0];
}

/** 同じトピックまたは同じSpeakerを持つ、自分以外のセッションを探す */
export function findSimilarSessions(sessions: Session[], target: Session): Session[] {
  const targetTopics = new Set(target.topics ?? []);
  const targetSpeakers = new Set((target.speakers ?? []).map((s) => s.name).filter(Boolean));

  return sessions.filter((s) => {
    if (s.sessionId === target.sessionId) return false;
    const sharesTopic = (s.topics ?? []).some((t) => targetTopics.has(t));
    const sharesSpeaker = (s.speakers ?? []).some((sp) => sp.name && targetSpeakers.has(sp.name));
    return sharesTopic || sharesSpeaker;
  });
}

export interface ConflictRecommendation {
  recommended: Session;
  reasons: Record<string, string>;
}

/**
 * 競合する複数セッションのうち、代替手段（再演・類似セッション）が無いものを推奨する。
 * 代替が複数ある場合は、より「回収しやすい」ものから外す（再演 > 類似セッション > 代替なし）。
 */
export function recommendForConflict(conflicting: Session[], allSessions: Session[]): ConflictRecommendation {
  const reasons: Record<string, string> = {};
  let best: { session: Session; recoverable: boolean } | undefined;

  for (const session of conflicting) {
    const repeat = findRepeat(allSessions, session);
    if (repeat) {
      reasons[session.sessionId] = `同一セッションの再演あり（${repeat.sessionId}）。回収可能`;
      if (!best) best = { session, recoverable: true };
      continue;
    }
    const similar = findSimilarSessions(allSessions, session);
    if (similar.length > 0) {
      reasons[session.sessionId] = `同トピック・同じSpeakerの別セッションあり（${similar.map((s) => s.sessionId).join(', ')}）。回収可能`;
      if (!best) best = { session, recoverable: true };
      continue;
    }
    reasons[session.sessionId] = '今回のみ。再演や類似セッションが見つからないため優先';
    if (!best || best.recoverable) best = { session, recoverable: false };
  }

  return { recommended: (best ?? { session: conflicting[0], recoverable: true }).session, reasons };
}

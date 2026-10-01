// 2026-09-28 実データ確認: CreatePersonalTime の title/description に半角 [ ] を含めると
// `400 The personal time entry could not be applied` で拒否される。日本語は問題なく通る。
// 情報を落とさないよう全角の角括弧に置き換える（除去はしない）。
export function sanitizeForPersonalTime(text: string): string {
  return text.replace(/\[/g, '〔').replace(/\]/g, '〕');
}

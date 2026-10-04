// 会場間の移動時間（分）。企画書 §5.3「Venetian、Wynn、MGM、Caesars に分散し、
// 会場間は20〜40分かかる」という大まかな記述のみを根拠にした仮の概算値。
// 実測値ではない（要検証）。実測できたらこのテーブルを差し替える。
const TRAVEL_MINUTES: Record<string, Record<string, number>> = {
  Venetian: { Wynn: 20, Caesars: 15, MGM: 35 },
  Wynn: { Venetian: 20, Caesars: 30, MGM: 40 },
  Caesars: { Venetian: 15, Wynn: 30, MGM: 20 },
  MGM: { Venetian: 35, Wynn: 40, Caesars: 20 },
};

/** 未知の会場ペアは安全側（最長の40分）に倒す */
const UNKNOWN_VENUE_FALLBACK_MINUTES = 40;

// カタログのvenueは "MGM Grand" / "Caesars Forum" / "Venetian"（2026-10-01実データ）で、テーブルのキーと一致しない
const VENUE_PATTERNS: [RegExp, string][] = [
  [/venetian/i, 'Venetian'],
  [/wynn/i, 'Wynn'],
  [/caesars/i, 'Caesars'],
  [/mgm/i, 'MGM'],
];

export function normalizeVenue(venue: string): string {
  return VENUE_PATTERNS.find(([pattern]) => pattern.test(venue))?.[1] ?? venue.trim();
}

export function getTravelMinutes(venueA: string, venueB: string): number {
  const a = normalizeVenue(venueA);
  const b = normalizeVenue(venueB);
  if (a === b) return 0;
  return TRAVEL_MINUTES[a]?.[b] ?? UNKNOWN_VENUE_FALLBACK_MINUTES;
}

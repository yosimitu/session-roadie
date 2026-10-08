// 会場間の移動時間（分）。実測値ではなく、公式のキャンパスマップ（縮尺なしの模式図）上の位置から
// 読み取った距離をもとにした推測値（要検証）。実測できたらこのテーブルを差し替える。
// 求め方: 縮尺は MGM Grand〜Caesars Palace を約1.2マイルと仮定して決めた（未確認）。
// - 0.7マイル未満は徒歩: 時速3マイルに、館内移動・通りの横断の待ち時間として一律8分を足す。
//   ただし Venetian↔Wynn/Encore、Venetian↔Forum、Wynn/Encore↔Forum は、指定により15分。
// - 0.7マイル以上はシャトル（指定された値）: 1.2マイル以下は20分、1.2マイル超は30分。
//   シャトルの運行時刻・停留所は未確認。
// Caesars Palace（Stripの西側）と Caesars Forum（東側、Harrah's/LINQの裏）は別の建物なので別会場として持つ。
// "Wynn" はカタログの "Wynn/Encore" 全体を指す。Encore 側（Wynnの約0.2マイル北）を見込んだ距離で求めてある。
// 推定距離: Venetian-Palace 0.7 / Forum-Palace 0.9 / Wynn・Encore-Palace 1.1 / MGM-Palace 1.2 /
//           MGM-Forum 1.4 / MGM-Venetian 1.6 / MGM-Wynn・Encore 1.8 マイル（0.7未満は徒歩）。
const TRAVEL_MINUTES: Record<string, Record<string, number>> = {
  Venetian: { Wynn: 15, 'Caesars Palace': 20, 'Caesars Forum': 15, MGM: 30 },
  Wynn: { Venetian: 15, 'Caesars Palace': 20, 'Caesars Forum': 15, MGM: 30 },
  'Caesars Palace': { Venetian: 20, Wynn: 20, 'Caesars Forum': 20, MGM: 20 },
  'Caesars Forum': { Venetian: 15, Wynn: 15, 'Caesars Palace': 20, MGM: 30 },
  MGM: { Venetian: 30, Wynn: 30, 'Caesars Palace': 20, 'Caesars Forum': 30 },
};

/** 未知の会場ペアは安全側（テーブルの最長30分を上回る40分）に倒す */
const UNKNOWN_VENUE_FALLBACK_MINUTES = 40;

// カタログのvenueは "MGM Grand" / "Wynn/Encore" / "Caesars Palace" / "Caesars Forum" / "Venetian"
// （2026-10-08のスナップショット）で、テーブルのキーと一致しない。
// "Caesars" だけではPalaceかForumか分からないので、どちらにも寄せず未知の会場として扱う。
const VENUE_PATTERNS: [RegExp, string][] = [
  [/venetian/i, 'Venetian'],
  [/wynn/i, 'Wynn'],
  [/caesars\s*palace/i, 'Caesars Palace'],
  [/caesars\s*forum/i, 'Caesars Forum'],
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

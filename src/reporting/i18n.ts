// 予定表HTML（`re-roadie view`）に出す文言を、日本語と英語で持つ。
// 日本語は従来の表示そのまま。英語は `--lang en` のときだけ使う。カタログ由来の文字列（タイトル・概要など）は翻訳しない。

export type Lang = 'ja' | 'en';
export const LANGS: readonly Lang[] = ['ja', 'en'];

export function parseLang(value: string | undefined): Lang {
  if (value === undefined) return 'ja';
  if ((LANGS as readonly string[]).includes(value)) return value as Lang;
  throw new Error(`lang は ${LANGS.join(' か ')} で指定してください（${value}）`);
}

/** 「セッション一覧」の状態の絞り込みと印に使う語。ブラウザ側の比較にもそのまま使う */
export interface StatusLabels {
  reserved: string;
  favorite: string;
  isNew: string;
  recommend: string;
  open: string;
  full: string;
  walkUp: string;
}

export const STATUS: Record<Lang, StatusLabels> = {
  ja: { reserved: '予約済み', favorite: '公式お気に入り', isNew: '新着', recommend: 'おすすめ', open: '空席あり', full: '満席', walkUp: '当日先着' },
  en: { reserved: 'Reserved', favorite: 'Official favorite', isNew: 'New', recommend: 'Recommended', open: 'Seats open', full: 'Full', walkUp: 'Walk-up' },
};

/** おすすめの理由（recommend.ts が組み立てる）。topic・type は呼び出し側で日本語表記に直してから渡す */
export interface RecommendStrings {
  priority: (rank: number, topic: string) => string;
  favorites: (topic: string) => string;
  interest: (topic: string) => string;
  type: (type: string) => string;
  open: string;
  limited: string;
  veryLimited: string;
  fits: string;
  isNew: string;
}

export const RECOMMEND: Record<Lang, RecommendStrings> = {
  ja: {
    priority: (rank, topic) => `優先${rank}位: ${topic}`,
    favorites: (topic) => `お気に入りの傾向: ${topic}`,
    interest: (topic) => `関心: ${topic}`,
    type: (type) => `形式: ${type}`,
    open: '空席あり',
    limited: '残り少なめ',
    veryLimited: '残りわずか',
    fits: '予定に収まる',
    isNew: '新着',
  },
  en: {
    priority: (rank, topic) => `Priority #${rank}: ${topic}`,
    favorites: (topic) => `Favorites trend: ${topic}`,
    interest: (topic) => `Interest: ${topic}`,
    type: (type) => `Format: ${type}`,
    open: 'Seats open',
    limited: 'Limited seats',
    veryLimited: 'Very few seats left',
    fits: 'Fits your schedule',
    isNew: 'New',
  },
};

/** ブラウザ側のスクリプトに JSON で渡す文言。`{0}` `{1}` は fmt() で置き換える */
export interface ClientStrings {
  weekdays: string[];
  dayFormat: string; // {0}=月 {1}=日 {2}=曜日
  dayTbd: string;
  dot: string; // 会場や形式を区切る記号
  timeBands: string[]; // 開始時間帯の6区分（10時前・10〜12・12〜14・14〜17・17時以降・未定）
  dims: string[]; // 絞り込みの見出し12個
  venueTbd: string;
  servicePlaceholder: string;
  serviceAria: string;
  count: string;
  minutes: string;
  labelAreas: string;
  labelServices: string;
  labelIndustries: string;
  labelFeatures: string;
  starAria: string;
  starTitle: string;
  recScore: string;
  recWhy: string;
  abstractLabel: string;
  emptyList: string;
  moreButton: string;
  collapseAll: string;
  expandAll: string;
  stats: string[]; // 上部の統計の見出し6個
  daysCount: string;
  newNote: string;
  newNoteNone: string;
  recipeSummary: string;
  recipePriority: string;
  recipeFavorites: string;
  recipeInterest: string;
  recipeWeight: string;
  recipeNone: string;
  recipePoints: string;
  recipeExcluded: string;
  recipeBasis: string;
  overview: string[]; // 全体像のパネル見出し8個
  memoCount: string;
  memoEmpty: string;
  memoDayCount: string;
  memoTbd: string;
  memoConflict: string;
  memoRemove: string;
  memoJump: string;
  csvHeader: string[];
  csvFilename: string;
  tagReserved: string;
  tagClashReserved: string;
  tagClashPersonal: string;
  tagMemo: string;
  /** 英→日の翻訳まわり。日本語版だけが持つ */
  tr: {
    absLabel: string;
    one: string;
    google: string;
    noApi: string;
    unavailable: string;
    preparing: string;
    downloading: string;
    failed: string;
    progress: string;
    done: string;
    error: string;
  } | null;
}

const CLIENT_JA: ClientStrings = {
  weekdays: ['日', '月', '火', '水', '木', '金', '土'],
  dayFormat: '{0}/{1}({2})',
  dayTbd: '日時未定',
  dot: ' ・ ',
  timeBands: ['〜10時', '10〜12時', '12〜14時', '14〜17時', '17時〜', '未定'],
  dims: ['状態', '日付', 'セッションタイプ', 'レベル', '役職（ロール）', 'トピック', '関心分野', '業種', 'AWSサービス', '特徴（形式）', '会場', '開始時間帯'],
  venueTbd: '会場未定',
  servicePlaceholder: 'サービス名で絞り込み',
  serviceAria: 'サービス検索',
  count: '{0} 件',
  minutes: '（{0}分）',
  labelAreas: '関心分野',
  labelServices: 'サービス',
  labelIndustries: '業種',
  labelFeatures: '特徴',
  starAria: 'メモ候補に追加',
  starTitle: 'メモ候補（このブラウザだけに保存。公式の予定は変わりません）',
  recScore: 'おすすめ度 {0}',
  recWhy: '（{0}）',
  abstractLabel: 'Abstract（原文）',
  emptyList: '条件に一致するセッションがありません。フィルターを緩めてください。',
  moreButton: 'さらに表示（残り {0} 件）',
  collapseAll: '概要を閉じる',
  expandAll: '概要をすべて開く',
  stats: ['セッション総数', '予約済み', '公式お気に入り', '新着', '開催日', '会場'],
  daysCount: '{0}日',
  newNote: '「新着」は {0} のスナップショットに無かったセッションです。',
  newNoteNone: '新着の比較元になる過去のスナップショットがありません。',
  recipeSummary: 'おすすめの基準（クリックで開く）',
  recipePriority: '優先{0}位',
  recipeFavorites: 'お気に入りの傾向',
  recipeInterest: '関心テーマ',
  recipeWeight: '重み {0}',
  recipeNone: 'お気に入りも、プロフィールの関心テーマも無いため、おすすめを計算できません。',
  recipePoints: '点数: トピックの重み×40 ＋ 優先形式 10 ＋ 空席 10（残りわずかは5）＋ 予定に収まる 15 ＋ 新着 5（80点満点を100点に換算）。おすすめ度 {0} 以上に「おすすめ」の印を付けます。',
  recipeExcluded: '除外: 予約済み・満席・当日先着、予約や個人予定と重なる（移動時間・最低空き時間を含む）、1日の上限、参加日の外、希望レベル超え、スポンサー除外、開始時刻より前。',
  recipeBasis: 'お気に入りの傾向を基本に、プロフィールで優先順位を決めていれば、それで上書きします。',
  overview: ['日付別', 'セッションタイプ別', '役職別', 'トピック別', 'レベル別', '会場別', '関心分野（上位15）', 'AWSサービス（上位15）'],
  memoCount: 'メモ候補 {0} 件',
  memoEmpty: '一覧で ☆ を押すと、ここに日別で表示されます。',
  memoDayCount: '（{0}件）',
  memoTbd: '未定',
  memoConflict: '⚠ 時間重複',
  memoRemove: 'メモから外す',
  memoJump: '一覧で詳細を見る →',
  csvHeader: ['コード', 'タイトル', 'タイトル（日本語）', '日付', '開始', '分', '会場', '部屋', 'タイプ', 'レベル', '役職', '登壇者'],
  csvFilename: 'reinvent2026_メモ候補.csv',
  tagReserved: '予約済み',
  tagClashReserved: '⚠ 予約と重複（{0}）',
  tagClashPersonal: '⚠ 個人予定と重複（{0}）',
  tagMemo: '★ メモ',
  tr: {
    absLabel: '概要（日本語訳）',
    one: 'このセッションを日本語訳',
    google: 'Google翻訳で開く ↗',
    noApi: 'このブラウザでは内蔵翻訳が使えません。最新のChromeで開くか、「Google翻訳で開く」を使ってください。',
    unavailable: '英→日の内蔵翻訳が利用できません。',
    preparing: '翻訳モデルを準備中…',
    downloading: '翻訳モデルをダウンロード中 {0}%',
    failed: '翻訳を開始できませんでした: {0}',
    progress: '翻訳中 {0}/{1}',
    done: '{0}件を日本語訳しました（このブラウザに保存済み）',
    error: '翻訳エラー: {0}',
  },
};

const CLIENT_EN: ClientStrings = {
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  dayFormat: '{0}/{1} ({2})',
  dayTbd: 'Date TBD',
  dot: ' · ',
  timeBands: ['Before 10:00', '10:00–12:00', '12:00–14:00', '14:00–17:00', 'After 17:00', 'TBD'],
  dims: ['Status', 'Date', 'Session type', 'Level', 'Role', 'Topic', 'Area of interest', 'Industry', 'AWS service', 'Format', 'Venue', 'Start time'],
  venueTbd: 'Venue TBD',
  servicePlaceholder: 'Filter by service name',
  serviceAria: 'Search services',
  count: '{0} sessions',
  minutes: ' ({0} min)',
  labelAreas: 'Areas of interest',
  labelServices: 'Services',
  labelIndustries: 'Industries',
  labelFeatures: 'Format',
  starAria: 'Add to note candidates',
  starTitle: 'Note candidate (saved in this browser only; your official schedule does not change)',
  recScore: 'Score {0}',
  recWhy: ' ({0})',
  abstractLabel: 'Abstract',
  emptyList: 'No sessions match these conditions. Try loosening the filters.',
  moreButton: 'Show more ({0} left)',
  collapseAll: 'Collapse abstracts',
  expandAll: 'Expand all abstracts',
  stats: ['Sessions', 'Reserved', 'Official favorites', 'New', 'Days', 'Venues'],
  daysCount: '{0}',
  newNote: '"New" means sessions that were not in the snapshot of {0}.',
  newNoteNone: 'There is no earlier snapshot to compare against for "New".',
  recipeSummary: 'How recommendations are scored (click to open)',
  recipePriority: 'priority #{0}',
  recipeFavorites: 'favorites trend',
  recipeInterest: 'declared interest',
  recipeWeight: 'weight {0}',
  recipeNone: 'There are no favorites or profile interests, so recommendations cannot be computed.',
  recipePoints: 'Score: topic weight × 40 + preferred format 10 + open seats 10 (5 if very few left) + fits your schedule 15 + new 5 (out of 80, scaled to 100). Sessions scoring {0} or more get the "Recommended" mark.',
  recipeExcluded: 'Excluded: reserved, full, or walk-up sessions; overlaps with reservations or personal time (including travel time and the minimum gap); the daily limit; days outside your attendance; above your preferred level; sponsored sessions if excluded; and starts before your earliest start time.',
  recipeBasis: 'Weights come from your favorites; if the profile sets a theme priority, it overrides them.',
  overview: ['By date', 'By session type', 'By role', 'By topic', 'By level', 'By venue', 'Areas of interest (top 15)', 'AWS services (top 15)'],
  memoCount: '{0} note candidates',
  memoEmpty: 'Press ☆ in the list and the sessions will appear here by day.',
  memoDayCount: ' ({0})',
  memoTbd: 'TBD',
  memoConflict: '⚠ Time overlap',
  memoRemove: 'Remove from notes',
  memoJump: 'See details in the list →',
  csvHeader: ['Code', 'Title', 'Title (translated)', 'Date', 'Start', 'Minutes', 'Venue', 'Room', 'Type', 'Level', 'Role', 'Speakers'],
  csvFilename: 'reinvent2026_note-candidates.csv',
  tagReserved: 'Reserved',
  tagClashReserved: '⚠ Overlaps a reservation ({0})',
  tagClashPersonal: '⚠ Overlaps personal time ({0})',
  tagMemo: '★ Note',
  tr: null,
};

export const CLIENT: Record<Lang, ClientStrings> = { ja: CLIENT_JA, en: CLIENT_EN };

/** HTML本体（サーバー側で組み立てる部分）の文言。HTMLを含むものは、埋め込む値をエスケープ済みで受け取る前提 */
export interface PageStrings {
  htmlLang: string;
  title: string;
  heading: string;
  subtitle: string;
  timezoneNote: string;
  created: (iso: string) => string;
  tabSchedule: string;
  tabList: string;
  tabOverview: string;
  tabMemo: string;
  scheduleSummary: (reserved: number, favorites: number, warnings: number) => string;
  segDay: string;
  segWeek: (days: number) => string;
  showFavorites: string;
  showMemo: string;
  scheduleHint: string;
  searchPlaceholder: string;
  searchAria: string;
  memoOnly: string;
  clear: string;
  sortLabel: string;
  sortTime: string;
  sortRecommend: string;
  sortCode: string;
  sortLevel: string;
  expandAll: string;
  translateAll: string | null;
  overviewHint: string;
  csvExport: string;
  memoHint: string;
  noSchedule: string;
  missing: (ids: string) => string;
  today: string;
  favoriteTag: string;
  seat: Record<'available' | 'limited' | 'veryLimited' | 'unavailable' | 'walkUp', string>;
  overlapTag: string;
  personalOverlapTag: (title: string) => string;
  travelShortTag: (needed: number, travel: number, arrival: number, available: number) => string;
  lunchTag: string;
  bands: { breakfast: string; lunch: string; night: string };
  weekdays: string[];
  weekdayLabel: (monthDay: string, weekday: string) => string;
  daySummary: (reserved: number, warnings: number) => string;
}

const PAGE_JA: PageStrings = {
  htmlLang: 'ja',
  title: 're:Roadie 予定',
  heading: 're:Roadie 予定とセッションカタログ',
  subtitle: '参照専用です。この画面から公式の予定は変更できません。☆のメモ候補はこのブラウザだけに保存されます。',
  timezoneNote: '時刻はすべて会場現地時間（PST）です。日本時間は +17時間（例: 現地 08:30 は日本時間 翌日 01:30）。',
  created: (iso) => `作成: ${iso}（UTC）。`,
  tabSchedule: '予定',
  tabList: 'セッション一覧',
  tabOverview: '全体像',
  tabMemo: 'メモ候補',
  scheduleSummary: (r, f, w) => `予約 ${r}件 / お気に入り ${f}件（未予約） / <span class="warn-text">警告 ${w}件</span>`,
  segDay: '日別',
  segWeek: (days) => `${days}日間通し`,
  showFavorites: '未予約のお気に入りも表示',
  showMemo: '★メモも表示',
  scheduleHint: 'カードをクリックすると、セッション一覧の詳細に移動します。一覧で付けた★（このブラウザだけのメモ）は右側の列に重なります。公式の予約・お気に入りは変わりません。',
  searchPlaceholder: 'キーワード検索（例: Bedrock）',
  searchAria: 'キーワード検索',
  memoOnly: '☆メモ候補のみ',
  clear: 'クリア',
  sortLabel: '並び替え',
  sortTime: '日時順',
  sortRecommend: 'おすすめ順',
  sortCode: 'コード順',
  sortLevel: 'レベル順',
  expandAll: '概要をすべて開く',
  translateAll: '表示中を日本語訳',
  overviewHint: '各項目をクリックすると、その条件で一覧を絞り込みます。',
  csvExport: 'CSVエクスポート',
  memoHint: '時間が重なる候補は赤く表示されます（会場間の移動時間は考慮していません）。このブラウザだけのメモで、公式の予定・予約には反映されません。★を押すとメモから外せます。',
  noSchedule: '表示できる予定がありません。',
  missing: (ids) => `カタログに見つからない予約（描画できませんでした）: ${ids}`,
  today: '今日',
  favoriteTag: '☆ お気に入り',
  seat: { available: '空席あり', limited: '残り少なめ', veryLimited: '残りわずか', unavailable: '満席', walkUp: '当日先着' },
  overlapTag: '⚠ 重複',
  personalOverlapTag: (title) => `⚠ 個人予定と重複（${title}）`,
  travelShortTag: (needed, travel, arrival, available) => `⚠ 移動不足（必要 ${needed}分＝移動${travel}分＋開始${arrival}分前までの到着 / 空き ${available}分）`,
  lunchTag: '⚠ 昼にかかる',
  bands: { breakfast: '朝食', lunch: 'ランチ', night: '18時以降' },
  weekdays: ['日', '月', '火', '水', '木', '金', '土'],
  weekdayLabel: (monthDay, weekday) => `${monthDay}(${weekday})`,
  daySummary: (r, w) => `予約 ${r}件${w > 0 ? ` / <span class="warn-text">警告 ${w}件</span>` : ''}`,
};

const PAGE_EN: PageStrings = {
  htmlLang: 'en',
  title: 're:Roadie Schedule',
  heading: 're:Roadie Schedule and Session Catalog',
  subtitle: 'Read-only. You cannot change your official schedule from this page. Note candidates (☆) are saved in this browser only.',
  timezoneNote: 'All times are venue local time (PST). Japan time is +17 hours (e.g. 08:30 local is 01:30 the next day in Japan).',
  created: (iso) => `Generated: ${iso} (UTC).`,
  tabSchedule: 'Schedule',
  tabList: 'Session list',
  tabOverview: 'Overview',
  tabMemo: 'Note candidates',
  scheduleSummary: (r, f, w) => `Reserved ${r} / Favorites ${f} (not reserved) / <span class="warn-text">Warnings ${w}</span>`,
  segDay: 'By day',
  segWeek: (days) => `All ${days} days`,
  showFavorites: 'Show unreserved favorites',
  showMemo: 'Show ★ notes',
  scheduleHint: 'Click a card to jump to its details in the session list. ★ notes added in the list (saved in this browser only) appear in the right column. Your official reservations and favorites do not change.',
  searchPlaceholder: 'Search keywords (e.g. Bedrock)',
  searchAria: 'Search keywords',
  memoOnly: '☆ Note candidates only',
  clear: 'Clear',
  sortLabel: 'Sort',
  sortTime: 'Date and time',
  sortRecommend: 'Recommended',
  sortCode: 'Code',
  sortLevel: 'Level',
  expandAll: 'Expand all abstracts',
  translateAll: null,
  overviewHint: 'Click an item to filter the list by that condition.',
  csvExport: 'Export CSV',
  memoHint: 'Overlapping candidates are shown in red (travel time between venues is not considered). These notes live in this browser only and are not reflected in your official schedule or reservations. Press ★ to remove one.',
  noSchedule: 'There is nothing to show in the schedule.',
  missing: (ids) => `Reservations not found in the catalog (could not be drawn): ${ids}`,
  today: 'Today',
  favoriteTag: '☆ Favorite',
  seat: { available: 'Seats open', limited: 'Limited seats', veryLimited: 'Very few seats left', unavailable: 'Full', walkUp: 'Walk-up' },
  overlapTag: '⚠ Overlap',
  personalOverlapTag: (title) => `⚠ Overlaps personal time (${title})`,
  travelShortTag: (needed, travel, arrival, available) => `⚠ Not enough travel time (needs ${needed} min = ${travel} min travel + arriving ${arrival} min before start / gap ${available} min)`,
  lunchTag: '⚠ Overlaps lunch',
  bands: { breakfast: 'Breakfast', lunch: 'Lunch', night: 'After 18:00' },
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdayLabel: (monthDay, weekday) => `${monthDay} (${weekday})`,
  daySummary: (r, w) => `Reserved ${r}${w > 0 ? ` / <span class="warn-text">Warnings ${w}</span>` : ''}`,
};

export const PAGE: Record<Lang, PageStrings> = { ja: PAGE_JA, en: PAGE_EN };

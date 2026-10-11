// 出典: https://api.awsevents.com/v1/openapi.json (2026-09-27 取得)

export type SeatAvailability = 'available' | 'limited' | 'veryLimited' | 'unavailable' | 'walkUp';

export interface SessionTime {
  date?: string;      // "2026-12-02"
  time?: string;       // "16:00"
  length?: string;      // 分, 文字列
  timezone?: string;
}

export interface Speaker {
  name?: string;
}

export interface Session {
  sessionId: string;
  title: string;
  abbreviation?: string;   // 例 "AIM101"。再演は同じ番号に "-R"/"-R1"/"-R2"… が付き、元番号が無い組もある（2026-10-01 実データで確認）
  abstract?: string;
  type?: string;           // 実値7種（2026-09-28確認）: "Breakout session" | "Chalk talk" | "Workshop" | "Builders' session" | "Code talk" | "Gamified learning" | "Lightning talk"。オンデマンド判定の代理指標
  level?: string;           // "300 - Advanced"
  venue?: string;
  room?: string;
  isAllDaySession?: boolean;
  isReservable?: boolean;
  seatAvailability?: SeatAvailability;
  sessionTime?: SessionTime;
  speakers?: Speaker[];
  tracks?: string[];
  topics?: string[];
  industries?: string[];
  areasOfInterest?: string[];
  roles?: string[];
  services?: string[];
  segments?: string[];
  features?: string[];
  customerPersonas?: string[];
  experiences?: string[];
  additionalActivities?: string[];
  focusAreas?: string[];
}

export interface EventAddress {
  city?: string;
}

export interface Event {
  eventId: string;
  name: string;
  eventType: string;
  startDate: string;
  endDate: string;
  isOnline: boolean;
  timezone?: string;
  timezoneAbbreviation?: string;
  timeFormat?: string;
  address?: EventAddress;
  supportedLanguageCodes?: string[];
  authenticationRequired: boolean;
}

export interface PersonalTime {
  personalTimeId: string;
  startDateTime: string; // "YYYY-MM-DDTHH:MM:SS" 会場の現地時刻（保存値がそのままアプリに表示される）
  endDateTime: string;
  title: string;
  description: string;
  location?: string;
}

export interface PersonalTimeInput {
  startDateTime: string; // 会場の現地時刻で書く（保存値がそのまま表示される）。5分刻み必須。末尾Z/オフセット禁止
  endDateTime: string;
  title: string;
  description: string;
  location?: string;
}

export interface Schedule {
  reserved: string[];      // sessionId[]
  favorites: string[];      // sessionId[]
  personalTime: PersonalTime[];
}

export type BulkFailureCode =
  | 'sessionNotReservable' | 'scheduleConflict' | 'alreadyScheduled'
  | 'sessionFull' | 'insufficientAccess' | 'timePassed'
  | 'alreadyFavorited' | 'notFavorited' | 'other';

export interface BulkFailure {
  sessionId: string;
  code: BulkFailureCode;
  conflictsWith?: string[]; // 時間衝突時のみ、既に予約済みの相手セッションID
}

export interface BulkResult {
  successful: string[];
  failed: BulkFailure[];
}

export interface ListSessionsPage {
  items: Session[];
  totalCount: number;
  nextToken?: string;
}

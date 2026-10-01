// 出典: https://docs.aws.amazon.com/events/latest/devguide/quotas.html

export type OperationName =
  | 'GetSession' | 'ListSessions' | 'GetSchedule'
  | 'ReserveSessions' | 'CancelReservation'
  | 'AssociateFavorites' | 'DisassociateFavorite'
  | 'CreatePersonalTime' | 'UpdatePersonalTime' | 'DeletePersonalTime';

const QUOTA_PER_MINUTE: Record<OperationName, number> = {
  GetSession: 120,
  ListSessions: 120,
  GetSchedule: 60,
  ReserveSessions: 30,
  CancelReservation: 30,
  AssociateFavorites: 30,
  DisassociateFavorite: 30,
  CreatePersonalTime: 30,
  UpdatePersonalTime: 30,
  DeletePersonalTime: 30,
};

interface ThrottledError {
  status: number;
  retryAfterSeconds: number;
}

function isThrottled(err: unknown): err is ThrottledError {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 429;
}

export class QuotaLimiter {
  quotaPerMinute(op: OperationName): number {
    return QUOTA_PER_MINUTE[op];
  }

  async withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (!isThrottled(err) || attempt >= maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, err.retryAfterSeconds * 1000));
      }
    }
  }
}

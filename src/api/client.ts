import { QuotaLimiter, type OperationName } from './quotas.js';

const BASE_URL = 'https://api.awsevents.com';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, public retryAfterSeconds?: number) {
    super(`API error ${status}`);
  }
}

/** Retry-Afterが無い/不正な場合は保守的に1秒待つ（quotas.htmlは秒数を返すとのみ記載） */
function parseRetryAfterSeconds(res: Response): number {
  const header = res.headers.get('Retry-After');
  const seconds = header ? Number(header) : NaN;
  return Number.isNaN(seconds) ? 1 : seconds;
}

interface ApiClientOptions {
  getAccessToken: () => string | undefined;
  quotaLimiter?: QuotaLimiter;
}

export class ApiClient {
  private quotaLimiter: QuotaLimiter;

  constructor(private options: ApiClientOptions) {
    this.quotaLimiter = options.quotaLimiter ?? new QuotaLimiter();
  }

  private headers(): Record<string, string> {
    const token = this.options.getAccessToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /** 429はquotas.html「Retrying a write safely」に従いRetry-Afterを尊重してリトライする */
  private async withQuota<T>(fn: () => Promise<T>): Promise<T> {
    return this.quotaLimiter.withRetry(fn);
  }

  async get<T>(path: string, operation: OperationName): Promise<T> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
      if (res.status === 429) throw new ApiError(429, undefined, parseRetryAfterSeconds(res));
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new ApiError(res.status, body);
      }
      return (await res.json()) as T;
    });
  }

  async postJson<T>(path: string, body: unknown, operation: OperationName): Promise<T> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) throw new ApiError(429, undefined, parseRetryAfterSeconds(res));
      if (!res.ok) {
        const errBody = await res.json().catch(() => undefined);
        throw new ApiError(res.status, errBody);
      }
      return (await res.json()) as T;
    });
  }

  async putJson<T>(path: string, body: unknown, operation: OperationName): Promise<T> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'PUT',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) throw new ApiError(429, undefined, parseRetryAfterSeconds(res));
      if (!res.ok) {
        const errBody = await res.json().catch(() => undefined);
        throw new ApiError(res.status, errBody);
      }
      return (await res.json()) as T;
    });
  }

  /** 削除系は404を「既に完了」として扱う（errors.html「Retrying a write safely」） */
  async deleteExpectNotFoundOk(path: string, operation: OperationName): Promise<'deleted' | 'alreadyGone'> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: this.headers() });
      if (res.status === 404) return 'alreadyGone';
      if (res.status === 429) throw new ApiError(429, undefined, parseRetryAfterSeconds(res));
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new ApiError(res.status, body);
      }
      return 'deleted';
    });
  }
}

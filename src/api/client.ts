import { QuotaLimiter, type OperationName } from './quotas.js';

const BASE_URL = 'https://api.awsevents.com';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public retryAfterSeconds?: number,
    public operation?: OperationName,
  ) {
    super(operation ? `API error ${status} (${operation})` : `API error ${status}`);
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

  /** 失敗レスポンスをApiErrorにする。429はQuotaLimiterがRetry-Afterを見てリトライできるよう秒数を持たせる */
  private async failure(res: Response, operation: OperationName): Promise<ApiError> {
    if (res.status === 429) return new ApiError(429, undefined, parseRetryAfterSeconds(res), operation);
    const body = await res.json().catch(() => undefined);
    return new ApiError(res.status, body, undefined, operation);
  }

  async get<T>(path: string, operation: OperationName): Promise<T> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
      if (!res.ok) throw await this.failure(res, operation);
      return (await res.json()) as T;
    });
  }

  /**
   * 2026-10-01 実機確認: 書き込み系（CreatePersonalTime等）は成功時に204 No Content（ボディ無し）
   * を返すため、res.json()を呼ばずundefinedを返す。
   */
  async postJson<T>(path: string, body: unknown, operation: OperationName): Promise<T> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await this.failure(res, operation);
      if (res.status === 204) return undefined as T;
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
      if (!res.ok) throw await this.failure(res, operation);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    });
  }

  /** 削除系は404を「既に完了」として扱う（errors.html「Retrying a write safely」） */
  async deleteExpectNotFoundOk(path: string, operation: OperationName): Promise<'deleted' | 'alreadyGone'> {
    return this.withQuota(async () => {
      const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: this.headers() });
      if (res.status === 404) return 'alreadyGone';
      if (!res.ok) throw await this.failure(res, operation);
      return 'deleted';
    });
  }
}

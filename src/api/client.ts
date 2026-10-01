const BASE_URL = 'https://api.awsevents.com';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API error ${status}`);
  }
}

interface ApiClientOptions {
  getAccessToken: () => string | undefined;
}

export class ApiClient {
  constructor(private options: ApiClientOptions) {}

  private headers(): Record<string, string> {
    const token = this.options.getAccessToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new ApiError(res.status, body);
    }
    return (await res.json()) as T;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => undefined);
      throw new ApiError(res.status, errBody);
    }
    return (await res.json()) as T;
  }

  async putJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => undefined);
      throw new ApiError(res.status, errBody);
    }
    return (await res.json()) as T;
  }

  /** 削除系は404を「既に完了」として扱う（errors.html「Retrying a write safely」） */
  async deleteExpectNotFoundOk(path: string): Promise<'deleted' | 'alreadyGone'> {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: this.headers() });
    if (res.status === 404) return 'alreadyGone';
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new ApiError(res.status, body);
    }
    return 'deleted';
  }
}

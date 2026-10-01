import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

export class TokenStore {
  constructor(private filePath: string) {}

  load(): StoredToken | undefined {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const token = JSON.parse(raw) as StoredToken;
      if (token.expiresAt <= Date.now()) return undefined;
      return token;
    } catch {
      return undefined;
    }
  }

  save(token: StoredToken): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    // トークンは個人情報。0600相当のパーミッションで保存する
    writeFileSync(this.filePath, JSON.stringify(token), { mode: 0o600 });
  }
}

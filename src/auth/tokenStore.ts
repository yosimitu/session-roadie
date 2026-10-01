import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

export class TokenStore {
  constructor(private filePath: string) {}

  /** access tokenの期限切れに関わらず生データを返す（refresh tokenは別の有効期限を持つため） */
  loadRaw(): StoredToken | undefined {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as StoredToken;
    } catch {
      return undefined;
    }
  }

  load(): StoredToken | undefined {
    const token = this.loadRaw();
    if (!token || token.expiresAt <= Date.now()) return undefined;
    return token;
  }

  save(token: StoredToken): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    // トークンは個人情報。0600相当のパーミッションで保存する
    writeFileSync(this.filePath, JSON.stringify(token), { mode: 0o600 });
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }
}

import type { TokenStore } from '../auth/tokenStore.js';
import { ensureAccessToken } from '../auth/signIn.js';
import { emailFromAccessToken } from '../auth/accountEmail.js';

export interface AuthStatus {
  signedIn: boolean;
  email?: string; // サインイン中の Builder ID のメール（表示用。取り出せないときは付かない）
  expiresAt?: string; // ISO8601（auth_loginと形式を揃える）
  refreshed?: boolean; // アクセストークン期限切れをrefresh tokenで更新した場合のみtrue
}

/**
 * アクセストークンが期限切れでも、refresh tokenで更新できればサインイン済みとして扱う
 * （更新できる状態で「未サインイン」と返すと、不要な再ログインを促してしまうため）。
 */
export async function runAuthStatus(
  tokenStore: TokenStore,
  refresh: (store: TokenStore) => Promise<string | undefined> = ensureAccessToken,
): Promise<AuthStatus> {
  const valid = tokenStore.load();
  if (valid) return { signedIn: true, ...withEmail(valid.accessToken), expiresAt: new Date(valid.expiresAt).toISOString() };

  if (!tokenStore.loadRaw()?.refreshToken) return { signedIn: false };
  if (!(await refresh(tokenStore))) return { signedIn: false };

  const renewed = tokenStore.load();
  if (!renewed) return { signedIn: false };
  return { signedIn: true, ...withEmail(renewed.accessToken), expiresAt: new Date(renewed.expiresAt).toISOString(), refreshed: true };
}

function withEmail(accessToken: string): { email?: string } {
  const email = emailFromAccessToken(accessToken);
  return email ? { email } : {};
}

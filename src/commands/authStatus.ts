import type { TokenStore } from '../auth/tokenStore.js';

export interface AuthStatus {
  signedIn: boolean;
  expiresAt?: number;
}

export function runAuthStatus(tokenStore: TokenStore): AuthStatus {
  const token = tokenStore.load();
  if (!token) return { signedIn: false };
  return { signedIn: true, expiresAt: token.expiresAt };
}

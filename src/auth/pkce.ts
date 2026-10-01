import { randomBytes, createHash } from 'node:crypto';

// RFC 7636: code_verifier は 43〜128文字、unreserved文字集合 [A-Za-z0-9-._~] から
// 暗号学的に安全な乱数で生成し、サインイン試行ごとに新しくする。
const VERIFIER_LENGTH = 64;
const UNRESERVED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const bytes = randomBytes(VERIFIER_LENGTH);
  let verifier = '';
  for (const byte of bytes) verifier += UNRESERVED_CHARS[byte % UNRESERVED_CHARS.length];
  return verifier;
}

/** code_verifierのSHA-256ダイジェストをbase64url（パディング無し）でエンコードする */
export function generateCodeChallenge(verifier: string): string {
  const digest = createHash('sha256').update(verifier).digest();
  return base64url(digest);
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

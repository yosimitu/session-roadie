/**
 * アクセストークン（JWT）の `email` を取り出す。表示のためだけで、署名は検証しない
 * （サインイン中のアカウントを人に見せる用途で、認可の判断には使わない）。
 * 取り出せないときは undefined を返す。
 */
export function emailFromAccessToken(accessToken: string | undefined): string | undefined {
  const payload = accessToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { email?: unknown };
    return typeof claims.email === 'string' && claims.email.includes('@') ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

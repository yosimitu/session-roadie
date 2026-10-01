// 出典: https://docs.aws.amazon.com/events/latest/devguide/auth-endpoints.html (2026-10-01 取得)
// サインイン手順: https://docs.aws.amazon.com/events/latest/devguide/auth-signing-in.html
// サインアウト手順: https://docs.aws.amazon.com/events/latest/devguide/auth-signing-out.html

export const AUTHORIZATION_ENDPOINT = 'https://oauth.awsevents.com/oauth2/authorize';
export const TOKEN_ENDPOINT = 'https://oauth.awsevents.com/oauth2/token';
export const REVOCATION_ENDPOINT = 'https://oauth.awsevents.com/oauth2/revoke';
export const APP_LOGOUT_ENDPOINT = 'https://oauth.awsevents.com/logout';
export const BUILDER_ID_SIGN_OUT_ENDPOINT = 'https://idp.awsevents.com/oidc/logout';

// client secretは無い（PKCEで保護されるpublicクライアント）。固定・共有のID。
export const CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';
export const SCOPE = 'openid email events/access';
export const IDENTITY_PROVIDER = 'AWSBuilderID';

// redirect_uriはループバックの6ポートのみ登録済み（ワイルドカード不可、完全一致）。
export const LOOPBACK_PORTS = [8484, 8485, 8486, 8487, 8488, 8489] as const;
export const DEFAULT_LOOPBACK_PORT = LOOPBACK_PORTS[0];

export function redirectUriFor(port: number): string {
  return `http://localhost:${port}/callback`;
}

export function logoutUriFor(port: number): string {
  return `http://localhost:${port}/logout`;
}

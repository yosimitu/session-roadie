import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../../src/auth/pkce.js';

describe('generateCodeVerifier', () => {
  it('43〜128文字のunreserved文字集合（英数字・-._~）を生成する', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('呼び出すたびに異なる値を生成する（サインイン試行ごとに新規）', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generateCodeChallenge', () => {
  it('SHA-256ダイジェストをbase64url（パディング無し）でエンコードする', () => {
    // RFC 7636 Appendix B の既知のテストベクタ
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('パディング文字(=)やURL非安全文字(+, /)を含まない', () => {
    const challenge = generateCodeChallenge(generateCodeVerifier());
    expect(challenge).not.toMatch(/[=+/]/);
  });
});

describe('generateState', () => {
  it('呼び出すたびに異なる値を生成する（CSRF対策）', () => {
    expect(generateState()).not.toBe(generateState());
  });

  it('空でない文字列を返す', () => {
    expect(generateState().length).toBeGreaterThan(0);
  });
});

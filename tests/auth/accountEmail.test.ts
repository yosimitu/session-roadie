import { describe, it, expect } from 'vitest';
import { emailFromAccessToken } from '../../src/auth/accountEmail.js';

const jwt = (claims: object): string =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

describe('emailFromAccessToken', () => {
  it('JWT の email を返す', () => {
    expect(emailFromAccessToken(jwt({ email: 'user@example.com', sub: 'x' }))).toBe('user@example.com');
  });
  it('email が無い、文字列でない、@ が無いときは undefined', () => {
    expect(emailFromAccessToken(jwt({ sub: 'x' }))).toBeUndefined();
    expect(emailFromAccessToken(jwt({ email: 123 }))).toBeUndefined();
    expect(emailFromAccessToken(jwt({ email: 'no-at-sign' }))).toBeUndefined();
  });
  it('JWT でない、壊れている、未指定のときも落ちずに undefined', () => {
    expect(emailFromAccessToken('not-a-jwt')).toBeUndefined();
    expect(emailFromAccessToken('a.%%%.c')).toBeUndefined();
    expect(emailFromAccessToken(undefined)).toBeUndefined();
  });
});

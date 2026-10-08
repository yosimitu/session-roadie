import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { toRoadieError, formatRoadieErrorForCli, mcpErrorResult } from '../src/errors.js';

describe('toRoadieError', () => {
  it('401はauthExpired', () => {
    const e = toRoadieError(new ApiError(401, { message: 'expired' }, undefined, 'GetSchedule'));
    expect(e).toMatchObject({ kind: 'authExpired', status: 401, operation: 'GetSchedule', body: { message: 'expired' } });
    expect(e.hint).toContain('auth_login');
  });

  it.each([403, 409])('ReserveSessionsの%iはnotOpenYet', (status) => {
    const e = toRoadieError(new ApiError(status, undefined, undefined, 'ReserveSessions'));
    expect(e.kind).toBe('notOpenYet');
    expect(e.hint).toContain('2026-10-08');
  });

  it('CancelReservationの409もnotOpenYet', () => {
    expect(toRoadieError(new ApiError(409, undefined, undefined, 'CancelReservation')).kind).toBe('notOpenYet');
  });

  it('予約以外の操作の409はnotOpenYetにならずunknown', () => {
    expect(toRoadieError(new ApiError(409, undefined, undefined, 'AssociateFavorites')).kind).toBe('unknown');
  });

  it('予約以外の403はforbidden', () => {
    expect(toRoadieError(new ApiError(403, undefined, undefined, 'GetSchedule')).kind).toBe('forbidden');
  });

  it('401は操作に関わらずauthExpiredが優先される（ReserveSessionsでも）', () => {
    expect(toRoadieError(new ApiError(401, undefined, undefined, 'ReserveSessions')).kind).toBe('authExpired');
  });

  it('429はrateLimited', () => {
    expect(toRoadieError(new ApiError(429, undefined, 1, 'GetSchedule')).kind).toBe('rateLimited');
  });

  it('5xxはunknownでbodyを保持する', () => {
    const e = toRoadieError(new ApiError(503, { message: 'down' }, undefined, 'ListSessions'));
    expect(e).toMatchObject({ kind: 'unknown', status: 503, body: { message: 'down' } });
  });

  it('operationが無いApiErrorでもmessageが組み立てられる', () => {
    const e = toRoadieError(new ApiError(500, undefined));
    expect(e.kind).toBe('unknown');
    expect(e.message).toContain('HTTP 500');
    expect(e.message).not.toContain('undefined');
  });

  it('fetchの接続失敗(TypeError: fetch failed)はnetwork', () => {
    expect(toRoadieError(new TypeError('fetch failed')).kind).toBe('network');
  });

  it('fetch由来でないTypeError（バグ）はnetworkにせずunknown', () => {
    const e = toRoadieError(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(e.kind).toBe('unknown');
    expect(e.message).toContain('Cannot read properties');
  });

  it('通常のErrorはmessageをそのまま使いunknown', () => {
    const e = toRoadieError(new Error('ローカルスナップショットがありません'));
    expect(e).toMatchObject({ kind: 'unknown', message: 'ローカルスナップショットがありません' });
    expect(e.hint).not.toBe('');
  });

  it('文字列やundefinedが投げられてもunknownとして扱える', () => {
    expect(toRoadieError('boom')).toMatchObject({ kind: 'unknown', message: 'boom' });
    expect(toRoadieError(undefined).kind).toBe('unknown');
  });
});

describe('formatRoadieErrorForCli', () => {
  it('エラーと次にすることの2行を返す', () => {
    const lines = formatRoadieErrorForCli(toRoadieError(new ApiError(401, undefined, undefined, 'GetSchedule')));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^エラー: /);
    expect(lines[1]).toMatch(/^次にすること: /);
  });

  it('bodyがあれば詳細を1行足す', () => {
    const lines = formatRoadieErrorForCli(toRoadieError(new ApiError(500, { message: 'boom' }, undefined, 'GetSchedule')));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('詳細: {"message":"boom"}');
  });
});

describe('mcpErrorResult', () => {
  it('isError:trueで、textにRoadieErrorのJSONが入る', () => {
    const result = mcpErrorResult(new ApiError(409, { message: 'x' }, undefined, 'ReserveSessions'));
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({ kind: 'notOpenYet', status: 409, operation: 'ReserveSessions', body: { message: 'x' } });
    expect(typeof parsed.hint).toBe('string');
  });
});

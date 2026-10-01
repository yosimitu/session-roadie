import { describe, it, expect } from 'vitest';
import { startLoopbackServer } from '../../src/auth/loopbackServer.js';

describe('startLoopbackServer', () => {
  it('/callback に code と state が来たら解決し、port と redirectUri を返す', async () => {
    const server = await startLoopbackServer();
    expect(server.redirectUri).toBe(`http://localhost:${server.port}/callback`);

    const resultPromise = server.waitForCallback();
    await fetch(`http://localhost:${server.port}/callback?code=CODE123&state=STATE123`);

    const result = await resultPromise;
    expect(result).toEqual({ code: 'CODE123', state: 'STATE123' });
    server.close();
  });

  it('認可サーバーがerrorを返した場合はerrorを解決する', async () => {
    const server = await startLoopbackServer();
    const resultPromise = server.waitForCallback();
    await fetch(`http://localhost:${server.port}/callback?error=access_denied&error_description=User+cancelled`);

    const result = await resultPromise;
    expect(result).toEqual({ error: 'access_denied', errorDescription: 'User cancelled' });
    server.close();
  });

  it('close()を呼ぶとサーバーが停止する', async () => {
    const server = await startLoopbackServer();
    const port = server.port;
    server.close();
    await expect(fetch(`http://localhost:${port}/callback?code=x&state=y`)).rejects.toThrow();
  });
});

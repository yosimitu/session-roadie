import { createServer, type Server } from 'node:http';
import { LOOPBACK_PORTS, redirectUriFor } from './constants.js';

export type CallbackResult =
  | { code: string; state: string }
  | { error: string; errorDescription?: string };

export interface LoopbackServer {
  port: number;
  redirectUri: string;
  /** /callback へのリクエストを待ち、codeとstate、またはerrorを返す */
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}

const SUCCESS_HTML = '<html><body>サインインが完了しました。このタブを閉じてください。</body></html>';
const ERROR_HTML = '<html><body>サインインに失敗しました。ターミナルに戻ってください。</body></html>';

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

/**
 * /callback 用のループバックHTTPサーバーを起動する。登録済みの6ポート（企画書 §9 確認済み）を
 * 順に試し、最初に使えたものを使う。redirect_uriは認可リクエストと完全一致している必要がある。
 */
export async function startLoopbackServer(): Promise<LoopbackServer> {
  let resolveCallback: ((result: CallbackResult) => void) | undefined;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(ERROR_HTML);
      resolveCallback?.({ error, errorDescription: url.searchParams.get('error_description') ?? undefined });
      return;
    }
    if (code && state) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_HTML);
      resolveCallback?.({ code, state });
      return;
    }
    res.writeHead(400).end();
  });

  let port: number | undefined;
  for (const candidate of LOOPBACK_PORTS) {
    try {
      await listen(server, candidate);
      port = candidate;
      break;
    } catch {
      // このポートは使用中。次を試す。
    }
  }
  if (port === undefined) {
    throw new Error(`ループバックポート（${LOOPBACK_PORTS.join(', ')}）がすべて使用中です`);
  }

  return {
    port,
    redirectUri: redirectUriFor(port),
    waitForCallback: () => new Promise((resolve) => { resolveCallback = resolve; }),
    close: () => server.close(),
  };
}

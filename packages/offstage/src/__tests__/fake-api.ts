/**
 * A stand-in for Offstage's API: a plaintext HTTP/2 (h2c) server on
 * 127.0.0.1. The provider reaches it through its real transport, the
 * connection pool, with `baseUrl: api.url`; nothing here leaves the machine.
 */

import * as http2 from 'node:http2';

export interface Seen {
  method: string;
  /** Path and query, as sent. */
  path: string;
  headers: http2.IncomingHttpHeaders;
  body: string;
  session: http2.ServerHttp2Session;
}

/** An answer, or a handler that answers (or breaks) the stream itself. */
export type Reply =
  | { status: number; json?: unknown; text?: string; headers?: Record<string, string>; delayMs?: number }
  | ((seen: Seen, stream: http2.ServerHttp2Stream) => void);

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({ status, json: body, headers });

export const failure = (status: number, code: string, message: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}): Reply =>
  json(status, { error: { code, message, requestId: 'req_9', ...extra } }, headers);

/** Kills the request's connection before answering it. */
export const killSession: Reply = (_seen, stream) => stream.session?.destroy();

export interface FakeApi {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** Every request received, in order of arrival. */
  readonly requests: Seen[];
  /** Every HTTP/2 session (client connection) ever opened. */
  readonly sessions: Set<http2.ServerHttp2Session>;
  /** Queues answers, used in order. */
  reply(...replies: Reply[]): void;
  /** Answers each request the queue has no answer for. Without one, such a request gets a 500. */
  otherwise(choose: (seen: Seen) => Reply): void;
  close(): Promise<void>;
}

function answer(reply: Reply, seen: Seen, stream: http2.ServerHttp2Stream): void {
  if (typeof reply === 'function') {
    reply(seen, stream);
    return;
  }
  const send = (): void => {
    if (stream.destroyed) return;
    const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.text ?? '');
    stream.respond({
      ':status': reply.status,
      ...(reply.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...reply.headers,
    });
    stream.end(body);
  };
  if (reply.delayMs) setTimeout(send, reply.delayMs);
  else send();
}

export function startApi(): Promise<FakeApi> {
  const queue: Reply[] = [];
  const requests: Seen[] = [];
  const sessions = new Set<http2.ServerHttp2Session>();
  const open = new Set<http2.ServerHttp2Session>();
  let fallback: ((seen: Seen) => Reply) | undefined;

  const server = http2.createServer();
  server.on('session', (session) => {
    sessions.add(session);
    open.add(session);
    session.on('error', () => {});
    session.on('close', () => open.delete(session));
  });
  server.on('sessionError', () => {});
  server.on('stream', (stream, headers) => {
    stream.on('error', () => {});
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const seen: Seen = {
        method: String(headers[':method']),
        path: String(headers[':path']),
        headers,
        body: Buffer.concat(chunks).toString('utf8'),
        session: stream.session as http2.ServerHttp2Session,
      };
      requests.push(seen);
      const reply = queue.shift()
        ?? fallback?.(seen)
        ?? json(500, { error: { code: 'unexpected-request', message: `no answer queued for ${seen.method} ${seen.path}` } });
      answer(reply, seen, stream);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('expected an AddressInfo'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        sessions,
        reply: (...replies) => queue.push(...replies),
        otherwise: (choose) => {
          fallback = choose;
        },
        // server.close() waits for every open session, and the client pool keeps its sessions open.
        close: () => new Promise((done) => {
          for (const session of open) session.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

/** Waits, yielding to I/O, until `condition` holds. Works under fake timers that leave setImmediate real. */
export async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

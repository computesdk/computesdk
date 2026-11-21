/**
 * Bursts of creates and large accounts against a local HTTP/2 server that, like the API, allows 256 concurrent
 * streams per connection, so most of a 1000-wide burst waits in the client's queue on the one shared session.
 *
 * Ways the client could fail, each covered below:
 * - A reset of one stream (REFUSED_STREAM, CANCEL) closes the shared session and fails the creates queued behind it.
 * - Connection rotation (a GOAWAY every few hundred streams) uses up the attempts of creates that were never sent.
 * - A create that is sent again starts a second sandbox.
 * - `instances.list()` stops at the first page of sandboxes.
 */
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeSessions } from '../client';
import { styne } from '../provider';
import type { StyneInstance } from '../provider';

const { NGHTTP2_CANCEL, NGHTTP2_NO_ERROR, NGHTTP2_REFUSED_STREAM } = http2.constants;
const MAX_STREAMS = 256;
const BURST = 1000;
const PAGE = 1000;

describe('a 1000-wide burst of creates on a server that allows 256 streams per connection', () => {
  let server: http2.Http2Server;
  const live = new Set<http2.ServerHttp2Session>();
  /** Sandboxes by Idempotency-Key: a repeat of a key answers with the sandbox the key started, as the API does. */
  const sandboxes = new Map<string, string>();
  let streams = 0;
  let sessions = 0;
  let next = 0;
  let unkeyed = 0;
  const faults = { refuseEvery: 0, cancelEvery: 0, goawayEvery: 0 };
  let listed: string[] = [];

  beforeAll(async () => {
    server = http2.createServer({ settings: { maxConcurrentStreams: MAX_STREAMS } });
    server.on('session', (session) => {
      sessions++;
      live.add(session);
      session.on('close', () => live.delete(session));
      session.on('error', () => undefined);
      let served = 0;
      session.on('stream', (stream) => {
        served++;
        if (faults.goawayEvery && served === faults.goawayEvery) session.goaway(NGHTTP2_NO_ERROR, stream.id);
      });
    });
    server.on('stream', (stream, headers) => {
      stream.on('error', () => undefined);
      const n = ++streams;
      stream.resume();
      stream.on('end', () => {
        const path = String(headers[':path']);
        if (headers[':method'] === 'GET' && path.startsWith('/sandboxes')) {
          const token = new URL(path, 'http://x').searchParams.get('nextToken');
          const start = token === null ? 0 : Number(token);
          const page = listed.slice(start, start + PAGE);
          const more = start + PAGE < listed.length;
          stream.respond({ ':status': 200, 'content-type': 'application/json', ...(more ? { 'x-next-token': String(start + PAGE) } : {}) });
          stream.end(JSON.stringify(page.map((id) => ({ sandboxID: id, domain: 'east.example.test' }))));
          return;
        }
        // Refused before any work: RFC 9113 section 8.7 says the request was not processed.
        if (faults.refuseEvery && n % faults.refuseEvery === 0) return stream.close(NGHTTP2_REFUSED_STREAM);
        const key = headers['idempotency-key'] as string | undefined;
        if (!key) unkeyed++;
        const id = sandboxes.get(String(key)) ?? `sbx-${++next}`;
        sandboxes.set(String(key), id);
        // Acted on, then cancelled before the answer: the client cannot know the sandbox exists.
        if (faults.cancelEvery && n % faults.cancelEvery === 0) return stream.close(NGHTTP2_CANCEL);
        setTimeout(() => {
          if (stream.destroyed) return;
          stream.respond({ ':status': 201, 'content-type': 'application/json' });
          stream.end(JSON.stringify({ sandboxID: id }));
        }, 5 + (n % 20));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    closeSessions();
    for (const session of live) session.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    closeSessions();
    for (const session of live) session.destroy();
    sandboxes.clear();
    streams = 0;
    sessions = 0;
    unkeyed = 0;
    Object.assign(faults, { refuseEvery: 0, cancelEvery: 0, goawayEvery: 0 });
  });

  const provider = () => styne({ apiKey: 'test-key', apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });

  const burst = async () => {
    const compute = provider();
    const results = await Promise.allSettled(Array.from({ length: BURST }, () => compute.instances.create()));
    const failures = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    const ids = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.instanceId] : []));
    return { failures, ids };
  };

  const expectOneSandboxPerCreate = ({ failures, ids }: { failures: string[]; ids: string[] }) => {
    expect(failures).toEqual([]);
    expect(new Set(ids).size).toBe(BURST);
    // Every sandbox the server started belongs to exactly one create: no create left a second one running.
    expect([...sandboxes.values()].sort()).toEqual([...ids].sort());
    expect(unkeyed).toBe(0);
  };

  it.each([
    ['REFUSED_STREAM on 1 stream in 300', { refuseEvery: 300 }],
    ['REFUSED_STREAM on 1 stream in 100', { refuseEvery: 100 }],
    ['CANCEL after the work on 1 stream in 100', { cancelEvery: 100 }],
    ['both', { refuseEvery: 97, cancelEvery: 101 }],
  ])('%s: every create succeeds on the one session, one sandbox each', async (_name, fault) => {
    Object.assign(faults, fault);
    const outcome = await burst();
    expectOneSandboxPerCreate(outcome);
    // A reset of one stream leaves the shared session in use.
    expect(sessions).toBe(1);
  }, 30_000);

  it.each([300, 500])('a GOAWAY every %i streams: creates that were never sent go out again on the next connection', async (every) => {
    faults.goawayEvery = every;
    const outcome = await burst();
    expectOneSandboxPerCreate(outcome);
    expect(sessions).toBeGreaterThan(1);
  }, 30_000);

  it('lists every sandbox of an account with more than one page of them', async () => {
    listed = Array.from({ length: 2 * PAGE + 345 }, (_, i) => `sbx-l${i}`);
    const all = await provider().instances.list();
    expect(all).toHaveLength(listed.length);
    expect(all.map((s) => (s.getInstance() as StyneInstance).id)).toEqual(listed);
    listed = [];
  });
});

describe('instances.list() paging', () => {
  let server: http2.Http2Server;
  const paths: string[] = [];
  let pages: Array<{ ids: string[]; next?: string }> = [];

  beforeAll(async () => {
    server = http2.createServer();
    server.on('stream', (stream, headers) => {
      stream.on('error', () => undefined);
      const path = String(headers[':path']);
      paths.push(path);
      const token = new URL(path, 'http://x').searchParams.get('nextToken');
      const page = pages[token === null ? 0 : Number(token.replace('t', ''))] ?? { ids: [] };
      stream.respond({ ':status': 200, 'content-type': 'application/json', ...(page.next ? { 'x-next-token': page.next } : {}) });
      stream.end(JSON.stringify(page.ids.map((id) => ({ sandboxID: id }))));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    closeSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = () => styne({ apiKey: 'test-key', apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });

  it('sends the token of each page back for the next one', async () => {
    paths.length = 0;
    pages = [{ ids: ['a', 'b'], next: 't1' }, { ids: ['c'], next: 't2' }, { ids: ['d'] }];
    expect((await provider().instances.list()).map((s) => s.instanceId)).toEqual(['a', 'b', 'c', 'd']);
    expect(paths).toEqual(['/sandboxes', '/sandboxes?nextToken=t1', '/sandboxes?nextToken=t2']);
  });

  it('fails instead of looping when the API names the same page twice', async () => {
    pages = [{ ids: ['a'], next: 't1' }, { ids: ['b'], next: 't1' }];
    await expect(provider().instances.list()).rejects.toThrow(/named page t1 twice/);
  });
});

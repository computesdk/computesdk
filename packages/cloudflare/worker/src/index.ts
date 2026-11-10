import { Files, SandboxFileError, SandboxProtocolError } from '@cloudflare/sandbox';
import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';

/**
 * ComputeSDK bridge for Cloudflare Containers.
 *
 * Keeps the three routes of the Cloudflare sandbox demo Worker wire-compatible
 * (create, exec, destroy) and adds container snapshots, native file transfer,
 * live exec output and port forwarding. `GET /v1/info` lets clients tell this
 * bridge apart from the demo, which answers it with 404.
 */

const BRIDGE_VERSION = 1;
const BRIDGE_FEATURES = ['exec-stream', 'files', 'ports', 'snapshots'] as const;

const DEFAULT_IMAGE = 'default';
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 10 * 60_000;
const MAX_INACTIVITY_TIMEOUT_MS = 6 * 60 * 60_000;
const HEARTBEAT_MS = 5_000;
const SNAPSHOT_INDEX_NAME = 'snapshots';

export interface BridgeEnv {
  SANDBOX_API_KEY?: string;
  SANDBOX_INACTIVITY_TIMEOUT_MS?: string;
  SANDBOX: DurableObjectNamespace<Sandbox>;
  SNAPSHOTS: DurableObjectNamespace<SnapshotIndex>;
}

export interface SandboxOptions {
  vcpu?: number;
  memoryMib?: number;
  diskMb?: number;
  image?: string;
  snapshotId?: string;
}

export interface ExecResult {
  stdout: ArrayBuffer;
  stderr: ArrayBuffer;
  exitCode: number;
}

export interface SnapshotRecord {
  id: string;
  name: string | null;
  size: number;
  sandboxId: string;
  createdAt: string;
}

export interface FileEntryRecord {
  name: string;
  type: string;
  size: number;
  modifiedAt: string;
}

class NotFoundError extends Error {}

function errorResponse(error: unknown, status = 500): Response {
  if (SandboxFileError.is(error)) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.code === 'ENOENT' ? 404 : error.code === 'EINVAL' ? 400 : 500 }
    );
  }
  if (SandboxProtocolError.is(error)) {
    return Response.json({ error: error.message, code: 'PROTOCOL' }, { status: 500 });
  }
  if (error instanceof NotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: error instanceof TypeError || error instanceof RangeError ? 400 : status }
  );
}

function methodNotAllowed(allow: string): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } });
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text === '') return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TypeError('request body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new TypeError('request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function sandboxOptions(options: object): SandboxOptions {
  const { vcpu, memoryMib, diskMb, image, snapshotId } = options as Record<string, unknown>;
  for (const [name, value] of Object.entries({ vcpu, memoryMib, diskMb })) {
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    ) {
      throw new TypeError(`${name} must be a positive number`);
    }
  }
  const sizes = [vcpu, memoryMib, diskMb].filter((value) => value !== undefined);
  if (sizes.length !== 0 && sizes.length !== 3) {
    throw new TypeError('vcpu, memoryMib, and diskMb must be set together');
  }
  if (image !== undefined && typeof image !== 'string') {
    throw new TypeError('image must be a string');
  }
  if (snapshotId !== undefined && (typeof snapshotId !== 'string' || snapshotId === '')) {
    throw new TypeError('snapshotId must be a non-empty string');
  }
  if (image !== undefined && snapshotId !== undefined) {
    throw new TypeError('image and snapshotId cannot be set together');
  }
  return { vcpu, memoryMib, diskMb, image, snapshotId } as SandboxOptions;
}

interface ExecRequest {
  argv: string[];
  cwd?: string;
  timeoutMs: number;
}

function execRequest(body: Record<string, unknown>): ExecRequest {
  const { argv, cwd, timeout_ms: timeoutMs = DEFAULT_EXEC_TIMEOUT_MS } = body;
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    !argv.every((value: unknown) => typeof value === 'string')
  ) {
    throw new TypeError('argv must be a non-empty array of strings');
  }
  if (cwd !== undefined && typeof cwd !== 'string') {
    throw new TypeError('cwd must be a string');
  }
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_EXEC_TIMEOUT_MS
  ) {
    throw new TypeError(
      `timeout_ms must be a positive number no greater than ${MAX_EXEC_TIMEOUT_MS}`
    );
  }
  return { argv: argv as string[], cwd, timeoutMs };
}

function inactivityTimeout(env: BridgeEnv): number {
  const value = Number(env.SANDBOX_INACTIVITY_TIMEOUT_MS ?? DEFAULT_INACTIVITY_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INACTIVITY_TIMEOUT_MS;
  return Math.min(value, MAX_INACTIVITY_TIMEOUT_MS);
}

function filePath(url: URL): string {
  const path = url.searchParams.get('path');
  if (!path || !path.startsWith('/')) {
    throw new TypeError('path must be an absolute path');
  }
  return path;
}

function sse(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/** Snapshot handles the bridge has created. The Worker API cannot list them. */
export class SnapshotIndex extends DurableObject<BridgeEnv> {
  constructor(ctx: DurableObjectState, env: BridgeEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        name TEXT,
        size INTEGER NOT NULL,
        sandbox_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    );
  }

  add(record: SnapshotRecord): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO snapshots (id, name, size, sandbox_id, created_at) VALUES (?, ?, ?, ?, ?)',
      record.id,
      record.name,
      record.size,
      record.sandboxId,
      record.createdAt
    );
  }

  get(id: string): SnapshotRecord | null {
    return this.records('SELECT * FROM snapshots WHERE id = ?', id)[0] ?? null;
  }

  list(): SnapshotRecord[] {
    return this.records('SELECT * FROM snapshots ORDER BY created_at DESC');
  }

  remove(id: string): boolean {
    return this.ctx.storage.sql.exec('DELETE FROM snapshots WHERE id = ?', id).rowsWritten > 0;
  }

  private records(query: string, ...bindings: unknown[]): SnapshotRecord[] {
    return this.ctx.storage.sql
      .exec<{ id: string; name: string | null; size: number; sandbox_id: string; created_at: string }>(
        query,
        ...bindings
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        sandboxId: row.sandbox_id,
        createdAt: row.created_at,
      }));
  }
}

export class Sandbox extends DurableObject<BridgeEnv> {
  #exitError: unknown;

  constructor(ctx: DurableObjectState, env: BridgeEnv) {
    super(ctx, env);
    // A restarted Durable Object does not inherit the inactivity timeout.
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(inactivityTimeout(env))
      );
    }
  }

  get container(): Container {
    if (this.ctx.container === undefined) {
      throw new Error('Container attachment is unavailable');
    }
    return this.ctx.container;
  }

  async start(options: SandboxOptions = {}): Promise<void> {
    // RPC callers skip the route validation, so validate here too.
    const { vcpu, memoryMib, diskMb, image, snapshotId } = sandboxOptions(options);
    const container = this.container;
    if (container.running) return;

    const instance =
      vcpu === undefined || memoryMib === undefined || diskMb === undefined
        ? ('standard-1' as const)
        : { vcpu, memoryMib, diskMb };
    const common = {
      instance,
      entrypoint: ['sh', '-c', 'sleep infinity'],
      enableInternet: true,
    };
    if (snapshotId !== undefined) {
      container.start({ ...common, containerSnapshot: { id: snapshotId } });
    } else {
      const imageReference = container.images[image ?? DEFAULT_IMAGE];
      if (imageReference === undefined) {
        throw new TypeError(`unknown image: ${image ?? DEFAULT_IMAGE}`);
      }
      container.start({ ...common, image: imageReference });
    }

    // start() reports failures, such as exceeded account limits, only
    // through monitor(). exec() reports them in place of a generic error.
    this.#exitError = undefined;
    container.monitor().catch((error: unknown) => {
      this.#exitError = error;
    });
    await container.setInactivityTimeout(inactivityTimeout(this.env));
  }

  #running(): Container {
    const container = this.container;
    if (!container.running && this.#exitError !== undefined) throw this.#exitError;
    return container;
  }

  async exec(argv: string[], cwd: string | undefined, timeoutMs: number): Promise<ExecResult> {
    const container = this.#running();
    // A timeout signal that fires after the process exits logs an internal
    // error, so the timer is cleared when the command ends.
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(`Command timed out after ${timeoutMs} ms`, 'TimeoutError')
        ),
      timeoutMs
    );
    try {
      const process = await container.exec(argv, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });
      const output = await process.output();
      controller.signal.throwIfAborted();
      return { stdout: output.stdout, stderr: output.stderr, exitCode: output.exitCode };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs a command and streams its output as server-sent events while it runs. */
  async execStream(argv: string[], cwd: string | undefined, timeoutMs: number): Promise<Response> {
    const container = this.#running();
    const process = await container.exec(argv, { cwd, stdout: 'pipe', stderr: 'pipe' });

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let closed = false;
    const send = (event: string, data: string) =>
      closed ? Promise.resolve() : writer.write(encoder.encode(sse(event, data)));

    let exited = false;
    process.exitCode.then(
      () => (exited = true),
      () => (exited = true)
    );
    // Signaling a process that has exited records an internal error.
    const stop = () => {
      if (!exited) process.kill();
    };
    const finish = async (error?: string) => {
      if (closed) return;
      if (error !== undefined) await send('error', JSON.stringify({ error }));
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(timer);
      await writer.close().catch(() => undefined);
    };

    writer.closed.catch(stop);
    const heartbeat = setInterval(() => {
      if (!closed) writer.write(encoder.encode(': keep-alive\n\n')).catch(() => undefined);
    }, HEARTBEAT_MS);
    // kill() reaches only the started process; children can hold the pipes
    // open, so the stream ends at the deadline whether or not they exit.
    const timer = setTimeout(() => {
      stop();
      void finish(`Command timed out after ${timeoutMs} ms`);
    }, timeoutMs);

    const forward = async (stream: ReadableStream<Uint8Array> | null, event: string) => {
      if (!stream) return;
      for await (const chunk of stream) {
        if (chunk.byteLength > 0) await send(event, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64'));
      }
    };

    void (async () => {
      try {
        await Promise.all([forward(process.stdout, 'stdout'), forward(process.stderr, 'stderr')]);
        await send('exit', JSON.stringify({ exit_code: await process.exitCode }));
        await finish();
      } catch (error) {
        stop();
        await finish(error instanceof Error ? error.message : String(error));
      }
    })();

    return new Response(readable, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/event-stream; charset=utf-8',
      },
    });
  }

  async destroy(): Promise<void> {
    if (this.container.running) await this.container.destroy();
  }

  /** Saves the container's writable root filesystem. The container keeps running. */
  async snapshot(sandboxId: string, name?: string): Promise<SnapshotRecord> {
    const container = this.#running();
    const snapshot = await container.snapshotContainer(name ? { name } : {});
    const record: SnapshotRecord = {
      id: snapshot.id,
      name: snapshot.name ?? null,
      size: snapshot.size,
      sandboxId,
      createdAt: new Date().toISOString(),
    };
    await this.env.SNAPSHOTS.getByName(SNAPSHOT_INDEX_NAME).add(record);
    return record;
  }

  async readFile(path: string): Promise<Response> {
    return new Files(this.#running()).readFile(path);
  }

  async writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<void> {
    await new Files(this.#running()).writeFile(path, content);
  }

  async listFiles(path: string): Promise<FileEntryRecord[]> {
    const files = new Files(this.#running());
    const entries = await files.readDirectory(path);
    const directory = path.endsWith('/') ? path : `${path}/`;
    return Promise.all(
      entries.map(async (entry) => {
        const stat = await files.lstat(`${directory}${entry.name}`);
        return {
          name: entry.name,
          type: entry.type,
          size: Number(stat.size),
          modifiedAt: stat.modifiedAt.toISOString(),
        };
      })
    );
  }

  async stat(path: string): Promise<{ type: string; size: number; modifiedAt: string } | null> {
    try {
      const stat = await new Files(this.#running()).stat(path);
      return { type: stat.type, size: Number(stat.size), modifiedAt: stat.modifiedAt.toISOString() };
    } catch (error) {
      if (SandboxFileError.is(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async mkdir(path: string): Promise<void> {
    await new Files(this.#running()).mkdir(path, { recursive: true });
  }

  async remove(path: string): Promise<void> {
    await new Files(this.#running()).remove(path, { recursive: true, force: true });
  }

  /** Forwards a preview request to a port in the container. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const port = Number(request.headers.get('X-Sandbox-Port'));
    const container = this.ctx.container;
    if (!container?.running) {
      return new Response('Sandbox is not running', { status: 503 });
    }
    const headers = new Headers(request.headers);
    headers.delete('X-Sandbox-Port');
    url.protocol = 'http:';
    try {
      return await container
        .getTcpPort(port)
        .fetch(
          new Request(new Request(url, request), { headers, redirect: 'manual' })
        );
    } catch (error) {
      return new Response(
        `Port ${port} is not reachable: ${error instanceof Error ? error.message : String(error)}`,
        { status: 502 }
      );
    }
  }
}

const SANDBOX_ROUTE = /^\/v1\/sandbox\/([^/]+)(?:\/(exec|snapshot|files|files\/list|files\/stat|files\/mkdir))?$/;
const PORT_ROUTE = /^\/v1\/sandbox\/([^/]+)\/ports\/(\d{1,5})(\/.*)?$/;
const SNAPSHOT_ROUTE = /^\/v1\/snapshots(?:\/([^/]+))?$/;

function sandboxStub(env: BridgeEnv, id: string): DurableObjectStub<Sandbox> | null {
  try {
    return env.SANDBOX.get(env.SANDBOX.idFromString(id));
  } catch {
    return null;
  }
}

async function forwardPreview(request: Request, env: BridgeEnv, match: RegExpExecArray): Promise<Response> {
  const [, id, portText, rest] = match;
  const port = Number(portText);
  if (port < 1 || port > 65535) return new Response('Not Found', { status: 404 });
  const stub = sandboxStub(env, id);
  if (!stub) return new Response('Not Found', { status: 404 });

  const url = new URL(request.url);
  url.pathname = rest ?? '/';
  const headers = new Headers(request.headers);
  headers.set('X-Sandbox-Port', String(port));
  return stub.fetch(new Request(new Request(url, request), { headers, redirect: 'manual' }));
}

async function sandboxRoute(
  request: Request,
  env: BridgeEnv,
  url: URL,
  id: string,
  operation: string | undefined
): Promise<Response> {
  const stub = sandboxStub(env, id);
  if (!stub) return new Response('Not Found', { status: 404 });
  const method = request.method;

  switch (operation) {
    case 'exec': {
      if (method !== 'POST') return methodNotAllowed('POST');
      const { argv, cwd, timeoutMs } = execRequest(await jsonBody(request));
      return await stub.execStream(argv, cwd, timeoutMs);
    }
    case 'snapshot': {
      if (method !== 'POST') return methodNotAllowed('POST');
      const { name } = await jsonBody(request);
      if (name !== undefined && typeof name !== 'string') {
        throw new TypeError('name must be a string');
      }
      return Response.json(await stub.snapshot(id, name));
    }
    case 'files': {
      const path = filePath(url);
      if (method === 'GET') return await stub.readFile(path);
      if (method === 'PUT') {
        await stub.writeFile(path, request.body ?? new Blob([]).stream());
        return new Response(null, { status: 204 });
      }
      if (method === 'DELETE') {
        await stub.remove(path);
        return new Response(null, { status: 204 });
      }
      return methodNotAllowed('GET, PUT, DELETE');
    }
    case 'files/list':
      if (method !== 'GET') return methodNotAllowed('GET');
      return Response.json({ entries: await stub.listFiles(filePath(url)) });
    case 'files/stat': {
      if (method !== 'GET') return methodNotAllowed('GET');
      const stat = await stub.stat(filePath(url));
      return stat ? Response.json(stat) : Response.json({ error: 'not found', code: 'ENOENT' }, { status: 404 });
    }
    case 'files/mkdir':
      if (method !== 'POST') return methodNotAllowed('POST');
      await stub.mkdir(filePath(url));
      return new Response(null, { status: 204 });
    default:
      if (method !== 'DELETE') return methodNotAllowed('DELETE');
      await stub.destroy();
      return new Response(null, { status: 204 });
  }
}

async function snapshotRoute(request: Request, env: BridgeEnv, id: string | undefined): Promise<Response> {
  const index = env.SNAPSHOTS.getByName(SNAPSHOT_INDEX_NAME);
  if (id === undefined) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    return Response.json({ snapshots: await index.list() });
  }
  const snapshotId = decodeURIComponent(id);
  if (request.method === 'GET') {
    const record = await index.get(snapshotId);
    return record ? Response.json(record) : new Response('Not Found', { status: 404 });
  }
  if (request.method !== 'DELETE') return methodNotAllowed('GET, DELETE');
  // Container snapshots cannot be deleted through the Worker API and expire
  // 30 days after their last restore; this removes the handle from the bridge.
  return (await index.remove(snapshotId))
    ? new Response(null, { status: 204 })
    : new Response('Not Found', { status: 404 });
}

async function createSandbox(request: Request, env: BridgeEnv): Promise<Response> {
  const options = sandboxOptions(await jsonBody(request));
  if (options.snapshotId !== undefined) {
    const record = await env.SNAPSHOTS.getByName(SNAPSHOT_INDEX_NAME).get(options.snapshotId);
    if (!record) throw new NotFoundError(`unknown snapshot: ${options.snapshotId}`);
  }
  const objectID = env.SANDBOX.newUniqueId();
  try {
    await env.SANDBOX.get(objectID).start(options);
  } catch (error) {
    return errorResponse(error, 503);
  }
  return Response.json({ id: objectID.toString() });
}

export default {
  async fetch(request: Request, env: BridgeEnv): Promise<Response> {
    const url = new URL(request.url);

    // Preview URLs are opened by browsers and HTTP clients without the API key.
    const preview = PORT_ROUTE.exec(url.pathname);
    if (preview) return forwardPreview(request, env, preview);

    if (
      !env.SANDBOX_API_KEY ||
      request.headers.get('Authorization') !== `Bearer ${env.SANDBOX_API_KEY}`
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      if (url.pathname === '/v1/info') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        return Response.json({
          bridge: 'computesdk',
          version: BRIDGE_VERSION,
          features: BRIDGE_FEATURES,
        });
      }

      if (url.pathname === '/v1/sandbox') {
        if (request.method !== 'POST') return methodNotAllowed('POST');
        return await createSandbox(request, env);
      }

      const snapshots = SNAPSHOT_ROUTE.exec(url.pathname);
      if (snapshots) return await snapshotRoute(request, env, snapshots[1]);

      const sandbox = SANDBOX_ROUTE.exec(url.pathname);
      if (sandbox) return await sandboxRoute(request, env, url, sandbox[1], sandbox[2]);

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<BridgeEnv>;

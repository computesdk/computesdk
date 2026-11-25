/**
 * Offstage provider for ComputeSDK: real macOS sandboxes on Apple silicon,
 * over Offstage's REST API (https://api.offstage.cloud/llms.txt).
 *
 * A create is one request and answers at once with a `pending` sandbox; a Mac
 * slot takes it in the background. The first command waits for that slot on
 * the server, so nothing here polls for readiness. A command is one request
 * too: it answers 200 with the result when it ends within about 50 s, and 202
 * otherwise, which is then followed with `?wait=50`.
 *
 * Every call goes over a small pool of HTTP/2 connections (transport.ts),
 * opened when this module is imported. With `lazyCreate`, `create()` sends
 * nothing and the first command creates the sandbox in the same request
 * (lazy-create.ts).
 */

import { randomUUID } from 'node:crypto';

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

import { DeferredCreate, placeholderId } from './lazy-create';
import { LazyHandles } from './lazy-handles';
import { preconnect, send } from './transport';

import type { HttpAnswer } from './transport';

export type OffstageSession = 'headless' | 'gui';

export interface OffstageConfig {
  /** Offstage API key (`sk_offstage_...`) - if not provided, falls back to the OFFSTAGE_API_KEY environment variable */
  apiKey?: string;
  /** Base URL of the Offstage API - falls back to OFFSTAGE_API_URL, then https://api.offstage.cloud */
  baseUrl?: string;
  /** `headless` (default) runs commands with no desktop; `gui` gives the sandbox a logged-in desktop session */
  session?: OffstageSession;
  /**
   * Defer each sandbox's create to its first use. `create()` then returns at
   * once without a request, and the first `runCommand()` creates the sandbox
   * and runs the command in one request; any other first call creates the
   * sandbox before doing its own work. Errors from the create surface on that
   * first call. `sandboxId` is then a placeholder that only this process
   * knows; read the real id from `getInfo().id`. Off by default; falls back to
   * the OFFSTAGE_LAZY_CREATE environment variable (`1` or `true`).
   */
  lazyCreate?: boolean;
}

/** The sandbox as Offstage's API returns it, plus the connection it was reached with. */
export interface OffstageSandbox {
  /** The sandbox id. On a lazily created handle, its placeholder until the first call creates the sandbox. */
  id: string;
  name: string;
  session: OffstageSession;
  state: 'pending' | 'ready' | 'closed';
  /** Unix milliseconds. */
  createdAt: number;
  expiresAt: number;
  timeoutMs: number;
  idleTimeoutMs: number;
  closeReason?: string;
  _apiKey: string;
  _baseUrl: string;
  [key: string]: unknown;
}

/** A failed Offstage API call: its `{error: {code, message, fix, requestId}}` envelope. */
export class OffstageError extends Error {
  constructor(
    /** The HTTP status. Undefined for a lazily created sandbox's first command that could not run: it is reported inside the create's answer, which has no status of its own. */
    readonly status: number | undefined,
    readonly code: string,
    readonly detail: string,
    readonly fix?: string,
    readonly requestId?: string,
  ) {
    super(
      `Offstage ${status === undefined ? '' : `${status} `}${code}: ${detail}` +
      (fix ? ` Fix: ${fix}.` : '') +
      (requestId ? ` (request ${requestId})` : ''),
    );
    this.name = 'OffstageError';
  }
}

const DEFAULT_BASE_URL = 'https://api.offstage.cloud';
/** Every Offstage API key starts with this. */
const KEY_PREFIX = 'sk_offstage_';
/** How long an op keeps retrying 409 `sandbox-not-ready` while its sandbox waits for a Mac slot. The server holds each try for 30 s. */
const SLOT_WAIT_MS = 120_000;
/** How long one call keeps waiting out 429s before giving up. */
const RATE_LIMIT_WAIT_MS = 120_000;
/** 429 codes that mean "not performed, send it again after Retry-After". */
const RETRY_AFTER_CODES = new Set(['rate-limit', 'uploads-busy']);
/** Methods the server treats a second copy of as the same request. A POST is one only when the caller says so. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);
/** Exit code reported for a command Offstage killed at its timeout (the API reports `exitCode: null`). */
const TIMEOUT_EXIT_CODE = 124;

const FIXED_SHAPE_REASON =
  'Offstage sandboxes have one fixed shape (a macOS user account on an Apple silicon Mac) and POST /v1/sandboxes takes no CPU, memory or disk fields, so no standard size can be selected.';

interface Connection { apiKey: string; baseUrl: string }

const baseUrlOf = (configured: string | undefined): string => (configured || DEFAULT_BASE_URL).replace(/\/+$/, '');

function connect(config: OffstageConfig): Connection {
  const apiKey = config.apiKey || process.env.OFFSTAGE_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'Missing Offstage API key.\n\n' +
      'Create one at https://console.offstage.cloud\n' +
      'Then pass it: offstage({ apiKey: "sk_offstage_..." })\n' +
      'Or set OFFSTAGE_API_KEY in your environment.',
    );
  }
  return { apiKey, baseUrl: baseUrlOf(config.baseUrl || process.env.OFFSTAGE_API_URL) };
}

const connectionOf = (sandbox: OffstageSandbox): Connection => ({ apiKey: sandbox._apiKey, baseUrl: sandbox._baseUrl });

const textOf = (res: HttpAnswer): string => res.body.toString('utf8');
const jsonOf = <T>(res: HttpAnswer): T => JSON.parse(textOf(res)) as T;
const header = (res: HttpAnswer, name: string): string | undefined => {
  const value = res.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

interface ErrorEnvelope { code?: string; message?: string; fix?: string; requestId?: string }

function toError(res: HttpAnswer): OffstageError {
  const text = textOf(res);
  let envelope: ErrorEnvelope | undefined;
  try {
    envelope = (JSON.parse(text) as { error?: ErrorEnvelope }).error;
  } catch { /* a proxy in front of the API can answer a 5xx that is not JSON */ }
  if (envelope?.code) {
    return new OffstageError(res.status, envelope.code, envelope.message ?? '', envelope.fix, envelope.requestId);
  }
  return new OffstageError(res.status, 'http-error', text.slice(0, 200) || `HTTP ${res.status}`, undefined, header(res, 'x-request-id'));
}

/**
 * One API call. A 429 `rate-limit` (or `uploads-busy`) was not performed, so
 * it is sent again after the seconds its `Retry-After` header gives. Every
 * other failure throws an {@link OffstageError}.
 */
async function request(
  conn: Connection,
  method: string,
  path: string,
  init: { json?: unknown; body?: string; headers?: Record<string, string>; idempotent?: boolean } = {},
): Promise<HttpAnswer> {
  const url = new URL(`${conn.baseUrl}${path}`);
  const headers: Record<string, string> = { authorization: `Bearer ${conn.apiKey}`, 'user-agent': 'computesdk-offstage' };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  if (init.body !== undefined) headers['content-type'] = 'application/octet-stream';
  Object.assign(headers, init.headers);
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const idempotent = init.idempotent ?? IDEMPOTENT_METHODS.has(method);
  const deadline = Date.now() + RATE_LIMIT_WAIT_MS;
  for (;;) {
    const res = await send({ method, url, headers, body, idempotent });
    if (res.status >= 200 && res.status < 300) return res;
    const error = toError(res);
    if (res.status === 429 && RETRY_AFTER_CODES.has(error.code)) {
      const retryAfter = header(res, 'retry-after');
      const waitMs = retryAfter !== undefined && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : undefined;
      if (waitMs !== undefined && Date.now() + waitMs <= deadline) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
    }
    throw error;
  }
}

/* ------------------------------ lazy create ------------------------------ */

interface CommandAnswer {
  commandId: string;
  state: 'running' | 'finished';
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
}

/** A create's `run`: what POST …/commands would have answered for the first command, or why it could not run. */
type FirstRun = CommandAnswer | { error: ErrorEnvelope & { code: string } };

/** The create of each lazily created handle. */
const deferredCreates = new WeakMap<OffstageSandbox, DeferredCreate<Record<string, unknown>, FirstRun | undefined>>();

/** What each lazy handle's placeholder id stands for (lazy-handles.ts). */
const lazyHandles = new LazyHandles<OffstageSandbox>();

function lazyCreateEnabled(config: OffstageConfig): boolean {
  if (config.lazyCreate !== undefined) return config.lazyCreate;
  const raw = process.env.OFFSTAGE_LAZY_CREATE;
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new Error(`OFFSTAGE_LAZY_CREATE must be 1, true, 0 or false, not ${JSON.stringify(raw)}`);
}

/** The API checks every field of a create, `run` included, before it makes anything: a 4xx made nothing. */
const madeNothing = (error: unknown): boolean =>
  error instanceof OffstageError && error.status !== undefined && error.status >= 400 && error.status < 500;

function lazySandbox(conn: Connection, body: Record<string, unknown>): OffstageSandbox {
  const placeholder = placeholderId();
  // Placeholders until the first call creates the sandbox and fills its record in.
  const sandbox = withConnection({
    id: placeholder,
    name: typeof body.name === 'string' ? body.name : '',
    session: body.session as OffstageSession,
    state: 'pending',
    createdAt: Date.now(),
    expiresAt: 0,
    timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : 0,
    idleTimeoutMs: 0,
  }, conn);
  deferredCreates.set(sandbox, new DeferredCreate(sandbox.id, async (run) => {
    const res = await request(conn, 'POST', '/v1/sandboxes', {
      json: run === undefined ? body : { ...body, run },
      headers: { 'idempotency-key': randomUUID() },
      // A replay of a create that carried `run` answers without it and runs
      // nothing, which would leave the first command's fate unknown: such a
      // create is sent again only when it never reached the API.
      idempotent: run === undefined,
    });
    const { run: first, ...record } = jsonOf<OffstageSandbox & { run?: FirstRun }>(res);
    // Filled in place: the framework and the caller hold this object.
    Object.assign(sandbox, record);
    lazyHandles.created(conn.apiKey, placeholder, sandbox.id);
    return first;
  }, madeNothing));
  lazyHandles.add(conn.apiKey, placeholder, sandbox);
  return sandbox;
}

/** Makes sure the sandbox behind `sandbox` exists, creating it on a lazy handle's first use. Rejects with the create's error. */
async function ensureCreated(sandbox: OffstageSandbox): Promise<void> {
  await deferredCreates.get(sandbox)?.begin().result;
}

/**
 * The first command of a lazy handle, sent with its create. Returns the
 * command's answer when the create ran it, and undefined when the sandbox
 * exists and the command still has to be sent the ordinary way: another call
 * created it, the sandbox existed already, or it was still waiting for a slot.
 */
async function runWithCreate(sandbox: OffstageSandbox, body: Record<string, unknown>): Promise<CommandAnswer | undefined> {
  const deferred = deferredCreates.get(sandbox);
  if (deferred === undefined) return undefined;
  const { starter, result } = deferred.begin(body);
  const first = await result;
  if (!starter) return undefined;
  if (first === undefined) {
    throw new Error(`Offstage: the create of sandbox ${sandbox.id} answered without its first command's result (\`run\`)`);
  }
  if ('error' in first) {
    // The sandbox exists and the command never ran.
    if (first.error.code === 'sandbox-not-ready') return undefined;
    throw new OffstageError(undefined, first.error.code, first.error.message ?? '', first.error.fix, first.error.requestId);
  }
  return first;
}

/* ------------------------------- sandboxes ------------------------------- */

/**
 * A call on a sandbox, which first makes sure it exists. While the sandbox is
 * `pending` the server holds the op up to 30 s for a slot and then answers
 * 409 `sandbox-not-ready`; the op never ran, so it is sent again.
 */
async function sandboxRequest(
  sandbox: OffstageSandbox,
  method: string,
  path: string,
  init?: { json?: unknown; body?: string },
): Promise<HttpAnswer> {
  await ensureCreated(sandbox);
  const deadline = Date.now() + SLOT_WAIT_MS;
  for (;;) {
    try {
      return await request(connectionOf(sandbox), method, `/v1/sandboxes/${encodeURIComponent(sandbox.id)}${path}`, init);
    } catch (error) {
      if (error instanceof OffstageError && error.code === 'sandbox-not-ready' && Date.now() < deadline) continue;
      throw error;
    }
  }
}

function commandBody(command: string, options?: RunCommandOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { cmd: command };
  if (options?.cwd) {
    // Offstage's `cwd` field is relative to the sandbox root, so an absolute directory is entered by the shell.
    if (!options.cwd.startsWith('/')) body.cwd = options.cwd;
    else body.cmd = `cd "${escapeShellArg(options.cwd)}" || exit 1\n${command}`;
  }
  if (options?.env && Object.keys(options.env).length > 0) body.envs = options.env;
  if (options?.timeout) body.timeoutMs = options.timeout;
  return body;
}

async function runForeground(sandbox: OffstageSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const startTime = Date.now();
  const body = commandBody(command, options);
  let answer = await runWithCreate(sandbox, body);
  if (answer === undefined) answer = jsonOf<CommandAnswer>(await sandboxRequest(sandbox, 'POST', '/commands', { json: body }));
  while (answer.state === 'running') {
    answer = jsonOf<CommandAnswer>(await sandboxRequest(sandbox, 'GET', `/commands/${encodeURIComponent(answer.commandId)}?wait=50`));
  }

  let exitCode: number;
  if (answer.timedOut) exitCode = TIMEOUT_EXIT_CODE;
  else if (typeof answer.exitCode === 'number') exitCode = answer.exitCode;
  else throw new Error(`Offstage: command ${answer.commandId} finished without an exit code`);
  return { stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', exitCode, durationMs: Date.now() - startTime };
}

/** Runs a filesystem command and throws when it fails. */
async function shell(sandbox: OffstageSandbox, command: string, what: string): Promise<CommandResult> {
  const result = await runForeground(sandbox, command);
  if (result.exitCode !== 0) {
    throw new Error(`Offstage: failed to ${what}: ${(result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`}`);
  }
  return result;
}

/**
 * The file route for `path`. Offstage's file routes address paths relative to
 * the sandbox root and refuse absolute ones; that is refused here, before any
 * request, so a probe of an absolute path never waits on the sandbox (or
 * creates a lazy one).
 */
function filesPath(path: string): string {
  if (path.startsWith('/')) {
    throw new Error(
      `Offstage: readFile and writeFile take a path relative to the sandbox root, not the absolute path ${path}. ` +
      'To reach a file elsewhere on the Mac, write or read it under the root and move or copy it with runCommand.',
    );
  }
  return `/files?path=${encodeURIComponent(path)}`;
}
const quoted = (path: string): string => `"${escapeShellArg(path)}"`;

function withConnection(record: Omit<OffstageSandbox, '_apiKey' | '_baseUrl'>, conn: Connection): OffstageSandbox {
  return { ...record, _apiKey: conn.apiKey, _baseUrl: conn.baseUrl } as OffstageSandbox;
}

export const offstage = defineProvider<OffstageSandbox, OffstageConfig>({
  name: 'offstage',
  sizes: () => ({ status: 'unsupported', reason: FIXED_SHAPE_REASON }),
  methods: {
    instances: {
      // One request. The sandbox comes back `pending`; its first op waits for the slot.
      // With lazyCreate, none: the first op creates it.
      create: async (config: OffstageConfig, options?: CreateInstanceOptions) => {
        const conn = connect(config);
        const body: Record<string, unknown> = { session: options?.session ?? config.session ?? 'headless' };
        if (options?.timeout) body.timeoutMs = options.timeout;
        if (options?.name) body.name = options.name;
        if (lazyCreateEnabled(config)) {
          const sandbox = lazySandbox(conn, body);
          return { instance: sandbox, instanceId: sandbox.id };
        }
        const res = await request(conn, 'POST', '/v1/sandboxes', {
          json: body,
          headers: { 'idempotency-key': randomUUID() },
          idempotent: true,
        });
        const sandbox = withConnection(jsonOf<OffstageSandbox>(res), conn);
        return { instance: sandbox, instanceId: sandbox.id };
      },

      getById: async (config: OffstageConfig, sandboxId: string) => {
        const conn = connect(config);
        const lazy = lazyHandles.get(conn.apiKey, sandboxId);
        if (lazy !== undefined && 'handle' in lazy) {
          // A placeholder that names no sandbox yet: looking it up creates it, so the caller gets a real one.
          await ensureCreated(lazy.handle);
          sandboxId = lazy.handle.id;
        } else if (lazy !== undefined) {
          sandboxId = lazy.id;
        }
        try {
          const res = await request(conn, 'GET', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`);
          const sandbox = withConnection(jsonOf<OffstageSandbox>(res), conn);
          return { instance: sandbox, instanceId: sandbox.id };
        } catch (error) {
          if (error instanceof OffstageError && error.status === 404) return null;
          throw error;
        }
      },

      // Open sandboxes: those waiting for a slot and those running.
      list: async (config: OffstageConfig) => {
        const conn = connect(config);
        const all: Array<{ instance: OffstageSandbox; instanceId: string }> = [];
        for (const state of ['pending', 'ready']) {
          let cursor: string | null = null;
          do {
            const query = new URLSearchParams({ state, limit: '200', ...(cursor ? { cursor } : {}) });
            const res = await request(conn, 'GET', `/v1/sandboxes?${query}`);
            const page = jsonOf<{ sandboxes: OffstageSandbox[]; nextCursor: string | null }>(res);
            for (const record of page.sandboxes) all.push({ instance: withConnection(record, conn), instanceId: record.id });
            cursor = page.nextCursor;
          } while (cursor);
        }
        return all;
      },

      destroy: async (config: OffstageConfig, sandboxId: string) => {
        const conn = connect(config);
        const lazy = lazyHandles.get(conn.apiKey, sandboxId);
        let id = sandboxId;
        if (lazy !== undefined && 'handle' in lazy) {
          const deferred = deferredCreates.get(lazy.handle)!;
          // From here no call on the handle can start a create.
          deferred.cancel();
          // Never used, or its create failed: there is no sandbox to destroy.
          if (!deferred.started || !(await deferred.settled())) {
            lazyHandles.forget(conn.apiKey, sandboxId);
            return;
          }
          id = lazy.handle.id;
        } else if (lazy !== undefined) {
          id = lazy.id;
        }
        try {
          await request(conn, 'DELETE', `/v1/sandboxes/${encodeURIComponent(id)}`);
        } catch (error) {
          // Already gone.
          if (!(error instanceof OffstageError && error.status === 404)) throw error;
        }
        // Through the placeholder or the real id: either way the placeholder names nothing now.
        lazyHandles.forget(conn.apiKey, sandboxId);
      },

      runCommand: async (sandbox: OffstageSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        // A background command is detached from the request with nohup: the API answers at once and the command keeps running.
        if (options?.background) {
          return runForeground(sandbox, `nohup sh -c "${escapeShellArg(command)}" >/dev/null 2>&1 &`, { ...options, background: false });
        }
        return runForeground(sandbox, command, options);
      },

      getInfo: async (sandbox: OffstageSandbox): Promise<InstanceInfo> => {
        await ensureCreated(sandbox);
        const res = await request(connectionOf(sandbox), 'GET', `/v1/sandboxes/${encodeURIComponent(sandbox.id)}`);
        const record = jsonOf<OffstageSandbox>(res);
        return {
          id: record.id,
          provider: 'offstage',
          status: record.state === 'closed' ? 'stopped' : 'running',
          createdAt: new Date(record.createdAt),
          timeout: record.timeoutMs,
          metadata: {
            name: record.name,
            session: record.session,
            state: record.state,
            expiresAt: record.expiresAt,
            idleTimeoutMs: record.idleTimeoutMs,
            closeReason: record.closeReason,
          },
        };
      },

      getUrl: async (sandbox: OffstageSandbox): Promise<string> => {
        await ensureCreated(sandbox);
        throw new Error('Offstage does not support getUrl: sandboxes expose no ports to the internet.');
      },

      // readFile and writeFile carry the bytes over Offstage's file routes. The
      // other four run in the shell, whose working directory is the sandbox
      // root, so a relative path means the same file in all six.
      filesystem: {
        readFile: async (sandbox: OffstageSandbox, path: string): Promise<string> => {
          const res = await sandboxRequest(sandbox, 'GET', filesPath(path));
          return textOf(res);
        },

        writeFile: async (sandbox: OffstageSandbox, path: string, content: string): Promise<void> => {
          await sandboxRequest(sandbox, 'PUT', filesPath(path), { body: content });
        },

        mkdir: async (sandbox: OffstageSandbox, path: string): Promise<void> => {
          await shell(sandbox, `mkdir -p -- ${quoted(path)}`, `create directory ${path}`);
        },

        readdir: async (sandbox: OffstageSandbox, path: string): Promise<FileEntry[]> => {
          // BSD stat: type, size, mtime (epoch seconds) and path, tab-separated, one entry per line.
          const result = await shell(
            sandbox,
            `find ${quoted(path)} -mindepth 1 -maxdepth 1 -exec stat -f '%HT%t%z%t%m%t%N' {} +`,
            `list directory ${path}`,
          );
          const entries: FileEntry[] = [];
          for (const line of result.stdout.split('\n')) {
            const [type, size, modified, ...rest] = line.split('\t');
            if (rest.length === 0) continue;
            const full = rest.join('\t');
            entries.push({
              name: full.slice(full.lastIndexOf('/') + 1),
              type: type === 'Directory' ? 'directory' : 'file',
              size: Number(size),
              modified: new Date(Number(modified) * 1000),
            });
          }
          return entries;
        },

        exists: async (sandbox: OffstageSandbox, path: string): Promise<boolean> => {
          const result = await runForeground(sandbox, `test -e ${quoted(path)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: OffstageSandbox, path: string): Promise<void> => {
          await shell(sandbox, `rm -rf -- ${quoted(path)}`, `remove ${path}`);
        },
      },

      getInstance: (sandbox: OffstageSandbox): OffstageSandbox => sandbox,
    },
  },
});

/**
 * Opens the connection pool when this module is imported. A caller that
 * constructs the provider inside its own timer (a benchmark task, a request
 * handler, a serverless invocation) would otherwise pay the TLS handshake on
 * its first request. Only with an Offstage key in OFFSTAGE_API_KEY, to the
 * origin of OFFSTAGE_API_URL (or the default API). It never throws, and the
 * idle connections are unref'd, so a script that imports the provider still
 * exits on its own. OFFSTAGE_PRECONNECT=0 (or false) turns it off.
 */
function preconnectOnImport(): void {
  const optOut = process.env.OFFSTAGE_PRECONNECT?.trim().toLowerCase();
  if (optOut === '0' || optOut === 'false') return;
  if (!(process.env.OFFSTAGE_API_KEY ?? '').startsWith(KEY_PREFIX)) return;
  preconnect(baseUrlOf(process.env.OFFSTAGE_API_URL));
}

try {
  preconnectOnImport();
} catch {
  // Importing the provider must never fail because of the preconnect.
}

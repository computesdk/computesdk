/**
 * Offstage provider for ComputeSDK: real macOS sandboxes on Apple silicon,
 * over Offstage's REST API (https://api.offstage.cloud/llms.txt).
 *
 * A create is one request and answers at once with a `pending` sandbox; a Mac
 * slot takes it in the background. The first command waits for that slot on
 * the server, so nothing here polls for readiness. A command is one request
 * too: it answers 200 with the result when it ends within about 50 s, and 202
 * otherwise, which is then followed with `?wait=50`.
 */

import { randomUUID } from 'node:crypto';

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

export type OffstageSession = 'headless' | 'gui';

export interface OffstageConfig {
  /** Offstage API key (`sk_offstage_...`) - if not provided, falls back to the OFFSTAGE_API_KEY environment variable */
  apiKey?: string;
  /** Base URL of the Offstage API - falls back to OFFSTAGE_API_URL, then https://api.offstage.cloud */
  baseUrl?: string;
  /** `headless` (default) runs commands with no desktop; `gui` gives the sandbox a logged-in desktop session */
  session?: OffstageSession;
}

/** The sandbox as Offstage's API returns it, plus the connection it was reached with. */
export interface OffstageSandbox {
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
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly fix?: string,
    readonly requestId?: string,
  ) {
    super(
      `Offstage ${status} ${code}: ${detail}` +
      (fix ? ` Fix: ${fix}.` : '') +
      (requestId ? ` (request ${requestId})` : ''),
    );
    this.name = 'OffstageError';
  }
}

const DEFAULT_BASE_URL = 'https://api.offstage.cloud';
/** How long an op keeps retrying 409 `sandbox-not-ready` while its sandbox waits for a Mac slot. The server holds each try for 30 s. */
const SLOT_WAIT_MS = 120_000;
/** How long one call keeps waiting out 429s before giving up. */
const RATE_LIMIT_WAIT_MS = 120_000;
/** 429 codes that mean "not performed, send it again after Retry-After". */
const RETRY_AFTER_CODES = new Set(['rate-limit', 'uploads-busy']);
/** Exit code reported for a command Offstage killed at its timeout (the API reports `exitCode: null`). */
const TIMEOUT_EXIT_CODE = 124;

const FIXED_SHAPE_REASON =
  'Offstage sandboxes have one fixed shape (a macOS user account on an Apple silicon Mac) and POST /v1/sandboxes takes no CPU, memory or disk fields, so no standard size can be selected.';

interface Connection { apiKey: string; baseUrl: string }

function connect(config: OffstageConfig): Connection {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.OFFSTAGE_API_KEY) || '';
  if (!apiKey) {
    throw new Error(
      'Missing Offstage API key.\n\n' +
      'Create one at https://console.offstage.cloud\n' +
      'Then pass it: offstage({ apiKey: "sk_offstage_..." })\n' +
      'Or set OFFSTAGE_API_KEY in your environment.',
    );
  }
  const baseUrl = (config.baseUrl || (typeof process !== 'undefined' && process.env?.OFFSTAGE_API_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

const connectionOf = (sandbox: OffstageSandbox): Connection => ({ apiKey: sandbox._apiKey, baseUrl: sandbox._baseUrl });

async function toError(res: Response): Promise<OffstageError> {
  const text = await res.text();
  let envelope: { code?: string; message?: string; fix?: string; requestId?: string } | undefined;
  try {
    envelope = (JSON.parse(text) as { error?: typeof envelope }).error;
  } catch { /* a proxy in front of the API can answer a 5xx that is not JSON */ }
  if (envelope?.code) {
    return new OffstageError(res.status, envelope.code, envelope.message ?? '', envelope.fix, envelope.requestId);
  }
  return new OffstageError(res.status, 'http-error', text.slice(0, 200) || res.statusText, undefined, res.headers.get('x-request-id') ?? undefined);
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
  init: { json?: unknown; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const deadline = Date.now() + RATE_LIMIT_WAIT_MS;
  for (;;) {
    const res = await fetch(`${conn.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${conn.apiKey}`,
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/octet-stream' } : {}),
        ...init.headers,
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    if (res.ok) return res;
    const error = await toError(res);
    if (res.status === 429 && RETRY_AFTER_CODES.has(error.code)) {
      const header = res.headers.get('retry-after');
      const waitMs = header !== null && /^\d+$/.test(header.trim()) ? Number(header) * 1000 : undefined;
      if (waitMs !== undefined && Date.now() + waitMs <= deadline) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
    }
    throw error;
  }
}

/**
 * A call on a sandbox. While the sandbox is `pending` the server holds the op
 * up to 30 s for a slot and then answers 409 `sandbox-not-ready`; the op never
 * ran, so it is sent again.
 */
async function sandboxRequest(
  sandbox: OffstageSandbox,
  method: string,
  path: string,
  init?: { json?: unknown; body?: string },
): Promise<Response> {
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

interface CommandAnswer {
  commandId: string;
  state: 'running' | 'finished';
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
}

async function runForeground(sandbox: OffstageSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const startTime = Date.now();
  const body: Record<string, unknown> = { cmd: command };
  if (options?.cwd) {
    // Offstage's `cwd` field is relative to the sandbox root, so an absolute directory is entered by the shell.
    if (!options.cwd.startsWith('/')) body.cwd = options.cwd;
    else body.cmd = `cd "${escapeShellArg(options.cwd)}" || exit 1\n${command}`;
  }
  if (options?.env && Object.keys(options.env).length > 0) body.envs = options.env;
  if (options?.timeout) body.timeoutMs = options.timeout;

  let res = await sandboxRequest(sandbox, 'POST', '/commands', { json: body });
  let answer = await res.json() as CommandAnswer;
  while (res.status === 202) {
    res = await sandboxRequest(sandbox, 'GET', `/commands/${encodeURIComponent(answer.commandId)}?wait=50`);
    answer = await res.json() as CommandAnswer;
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
 * request, so a probe of an absolute path never waits on the sandbox.
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
      create: async (config: OffstageConfig, options?: CreateInstanceOptions) => {
        const conn = connect(config);
        const body: Record<string, unknown> = { session: options?.session ?? config.session ?? 'headless' };
        if (options?.timeout) body.timeoutMs = options.timeout;
        if (options?.name) body.name = options.name;
        const res = await request(conn, 'POST', '/v1/sandboxes', {
          json: body,
          headers: { 'idempotency-key': randomUUID() },
        });
        const sandbox = withConnection(await res.json() as OffstageSandbox, conn);
        return { instance: sandbox, instanceId: sandbox.id };
      },

      getById: async (config: OffstageConfig, sandboxId: string) => {
        const conn = connect(config);
        try {
          const res = await request(conn, 'GET', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`);
          const sandbox = withConnection(await res.json() as OffstageSandbox, conn);
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
            const page = await res.json() as { sandboxes: OffstageSandbox[]; nextCursor: string | null };
            for (const record of page.sandboxes) all.push({ instance: withConnection(record, conn), instanceId: record.id });
            cursor = page.nextCursor;
          } while (cursor);
        }
        return all;
      },

      destroy: async (config: OffstageConfig, sandboxId: string) => {
        const conn = connect(config);
        try {
          await request(conn, 'DELETE', `/v1/sandboxes/${encodeURIComponent(sandboxId)}`);
        } catch (error) {
          // Already gone.
          if (error instanceof OffstageError && error.status === 404) return;
          throw error;
        }
      },

      runCommand: async (sandbox: OffstageSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        if (options?.background) {
          throw new Error(
            'Offstage does not support background commands: its API answers a command when the command ends, ' +
            'and ComputeSDK\'s shell process tier needs `setsid`, which macOS does not have. ' +
            'Run the command in the foreground (a long one is followed until it ends).',
          );
        }
        return runForeground(sandbox, command, options);
      },

      getInfo: async (sandbox: OffstageSandbox): Promise<InstanceInfo> => {
        const res = await request(connectionOf(sandbox), 'GET', `/v1/sandboxes/${encodeURIComponent(sandbox.id)}`);
        const record = await res.json() as OffstageSandbox;
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

      getUrl: async (): Promise<string> => {
        throw new Error('Offstage does not support getUrl: sandboxes expose no ports to the internet.');
      },

      // readFile and writeFile carry the bytes over Offstage's file routes. The
      // other four run in the shell, whose working directory is the sandbox
      // root, so a relative path means the same file in all six.
      filesystem: {
        readFile: async (sandbox: OffstageSandbox, path: string): Promise<string> => {
          const res = await sandboxRequest(sandbox, 'GET', filesPath(path));
          return res.text();
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

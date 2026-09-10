import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import tls from 'node:tls';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

const PROVIDER = 'cocoonstack' as const;
const DEFAULT_TEMPLATE = 'node-rt:24.04';
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 86_400;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const COMMAND_HTTP_TIMEOUT_BUFFER_MS = 5_000;
const MAX_RESPONSE_BYTES = 16 << 20;
const SIZES = [
  { size: 'small', cpu: 1, memoryMb: 512 },
  { size: 'medium', cpu: 2, memoryMb: 1024 },
  { size: 'large', cpu: 4, memoryMb: 4096 },
  { size: 'xlarge', cpu: 4, memoryMb: 8192 },
  { size: '2xlarge', cpu: 8, memoryMb: 16384 },
] as const;

export type CocoonstackSize = (typeof SIZES)[number]['size'];
export type CocoonstackNet = 'none' | 'egress';

export interface CocoonstackConfig {
  /** sandboxd endpoint, e.g. https://sandbox.example.com. Falls back to COCOONSTACK_API_URL. */
  baseUrl?: string;
  /** Node or tenant API token. Falls back to COCOONSTACK_API_KEY. */
  apiKey?: string;
  /** Default template, a pool key such as node-rt:24.04. */
  template?: string;
  /** Default network lane. */
  net?: CocoonstackNet;
  /** Default size tier. */
  size?: CocoonstackSize;
  /** Default claim lease in seconds; the node reaps the sandbox after it. */
  ttlSeconds?: number;
  /** HTTP request timeout. */
  requestTimeoutMs?: number;
}

export interface CocoonstackSandbox {
  id: string;
  /** The claim token; every call on the sandbox authenticates with it. */
  token: string;
  template: string;
  net: CocoonstackNet;
  size: CocoonstackSize;
  createdAt: Date;
  deadline: Date;
  config: CocoonstackConfig;
}

export class CocoonstackApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CocoonstackApiError';
  }
}

interface Resolved {
  baseUrl: string;
  apiKey: string;
  template: string;
  net: CocoonstackNet;
  size: CocoonstackSize;
  ttlSeconds: number;
  requestTimeoutMs: number;
}

interface ClaimResponse {
  id: string;
  token: string;
  deadline: string;
  redirect?: string[];
}

interface ExecResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
}

interface SandboxRow {
  id: string;
  key: { template: string; net: CocoonstackNet; size: CocoonstackSize };
  deadline: string;
}

interface Frame {
  type: string;
  data?: string;
  code?: number;
  pid?: number;
  kind?: string;
  message?: string;
}

interface Claim {
  token: string;
  deadline: number;
}

interface RelayOptions {
  timeoutMs?: number;
  detach?: boolean;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

type Exec = (sandbox: CocoonstackSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

type Lane = 'main' | 'release';

// sandboxd scopes a sandbox to its claim token; by-id calls look it up here, keyed per endpoint
const claimTokens = new Map<string, Claim>();
// one HTTP/2 session per origin and lane: a burst multiplexes over one TLS connection,
// and releases ride their own session so a slow teardown never queues a claim or exec
const sessions = new Map<string, http2.ClientHttp2Session>();
const sessionStreams = new WeakMap<http2.ClientHttp2Session, number>();
// building a TLS context parses the CA store; one per process, not one per session
const secureContext = tls.createSecureContext();
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function env(name: string): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env[name];
}

function resolve(config: CocoonstackConfig): Resolved {
  const baseUrl = config.baseUrl || env('COCOONSTACK_API_URL') || '';
  if (!baseUrl) {
    throw new Error(
      'Missing Cocoon Stack endpoint. Pass baseUrl or set COCOONSTACK_API_URL to your sandboxd address.',
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey: config.apiKey || env('COCOONSTACK_API_KEY') || '',
    template: config.template ?? DEFAULT_TEMPLATE,
    net: config.net ?? 'none',
    size: config.size ?? 'small',
    ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

function claimKey(resolved: Resolved, id: string): string {
  return `${resolved.baseUrl} ${id}`;
}

function rememberClaim(resolved: Resolved, id: string, token: string, deadline: Date): void {
  const now = Date.now();
  for (const [key, claim] of claimTokens) {
    if (claim.deadline < now) claimTokens.delete(key);
  }
  claimTokens.set(claimKey(resolved, id), { token, deadline: deadline.getTime() });
}

function retainedToken(resolved: Resolved, id: string): string | undefined {
  const key = claimKey(resolved, id);
  const claim = claimTokens.get(key);
  if (!claim) return undefined;
  if (claim.deadline < Date.now()) {
    claimTokens.delete(key);
    return undefined;
  }
  return claim.token;
}

function detail(body: string): string {
  const match = /"error"\s*:\s*"([^"]*)"/.exec(body);
  return match?.[1] ?? body;
}

function session(origin: string, lane: Lane): http2.ClientHttp2Session {
  const key = `${lane} ${origin}`;
  const live = sessions.get(key);
  if (live && !live.closed && !live.destroyed) return live;
  const created = http2.connect(origin, { secureContext });
  const drop = () => {
    if (sessions.get(key) === created) sessions.delete(key);
  };
  created.on('connect', () => applyHold(created));
  created.on('close', drop);
  created.on('goaway', drop);
  created.on('error', drop);
  sessions.set(key, created);
  return created;
}

// an idle session must not keep the process alive; a session with streams in flight must
function holdSession(live: http2.ClientHttp2Session): () => void {
  sessionStreams.set(live, (sessionStreams.get(live) ?? 0) + 1);
  applyHold(live);
  return () => {
    sessionStreams.set(live, Math.max(0, (sessionStreams.get(live) ?? 1) - 1));
    applyHold(live);
  };
}

function applyHold(live: http2.ClientHttp2Session): void {
  const socket = live.socket as { ref?: () => void; unref?: () => void } | undefined;
  if (!socket) return;
  if ((sessionStreams.get(live) ?? 0) > 0) socket.ref?.();
  else socket.unref?.();
}

function h2Request(
  origin: string,
  lane: Lane,
  method: string,
  path: string,
  headers: Record<string, string>,
  payload: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  return new Promise((fulfill, reject) => {
    const live = session(origin, lane);
    const release = holdSession(live);
    const stream = live.request({ ':method': method, ':path': path, ...headers });
    let status = 0;
    let text = '';
    const abort = () => stream.close(http2.constants.NGHTTP2_CANCEL);
    signal?.addEventListener('abort', abort, { once: true });
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', abort);
      release();
    };
    stream.setEncoding('utf8');
    stream.setTimeout(timeoutMs, () => {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      reject(new Error('sandboxd request timed out'));
    });
    stream.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status'] ?? 0);
    });
    stream.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MAX_RESPONSE_BYTES) {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error(`sandboxd response exceeds ${MAX_RESPONSE_BYTES >> 20} MiB`));
      }
    });
    stream.on('end', () => {
      done();
      fulfill({ status, text });
    });
    stream.on('error', (error: Error) => {
      done();
      reject(signal?.aborted ? (signal.reason instanceof Error ? signal.reason : new Error('aborted')) : error);
    });
    stream.on('close', done);
    stream.end(payload);
  });
}

function h1Request(
  url: URL,
  method: string,
  headers: Record<string, string>,
  payload: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  return new Promise((fulfill, reject) => {
    const secure = url.protocol === 'https:';
    const client = (secure ? https : http).request(
      url,
      {
        method,
        agent: secure ? httpsAgent : httpAgent,
        timeout: timeoutMs,
        signal,
        headers: {
          ...headers,
          ...(payload === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
          if (text.length > MAX_RESPONSE_BYTES) {
            client.destroy(new Error(`sandboxd response exceeds ${MAX_RESPONSE_BYTES >> 20} MiB`));
          }
        });
        response.on('error', reject);
        response.on('end', () => fulfill({ status: response.statusCode ?? 0, text }));
      },
    );
    client.on('timeout', () => client.destroy(new Error('sandboxd request timed out')));
    client.on('error', reject);
    client.end(payload);
  });
}

/** JSON call to sandboxd: HTTP/2 on TLS origins, HTTP/1.1 keep-alive otherwise. */
async function request<T>(
  resolved: Resolved,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = resolved.requestTimeoutMs,
  lane: Lane = 'main',
): Promise<T> {
  const url = new URL(`${resolved.baseUrl}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const { status, text } =
    url.protocol === 'https:'
      ? await h2Request(url.origin, lane, method, `${url.pathname}${url.search}`, headers, payload, timeoutMs, signal)
      : await h1Request(url, method, headers, payload, timeoutMs, signal);
  if (status < 200 || status >= 300) {
    throw new CocoonstackApiError(status, `sandboxd ${method} ${path} failed (${status}): ${detail(text)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

function isSize(value: string): value is CocoonstackSize {
  return SIZES.some((tier) => tier.size === value);
}

function sizeFor(resolved: Resolved, options?: CreateSandboxOptions): CocoonstackSize {
  if (options?.size !== undefined) {
    if (!isSize(options.size)) {
      throw new Error(
        `Unknown Cocoon Stack size ${JSON.stringify(options.size)}; one of ${SIZES.map((tier) => tier.size).join(', ')}.`,
      );
    }
    return options.size;
  }
  const cpu = options?.vcpus ?? options?.cpus ?? options?.cpu;
  const memoryMb = options?.memoryMb ?? options?.memoryMiB ?? options?.memMiB ?? options?.memory;
  if (cpu === undefined && memoryMb === undefined) return resolved.size;
  const tier = SIZES.find((candidate) => candidate.cpu >= (cpu ?? 0) && candidate.memoryMb >= (memoryMb ?? 0));
  if (!tier) {
    throw new Error(
      `No Cocoon Stack size tier offers ${cpu ?? '-'} CPU / ${memoryMb ?? '-'} MB; the largest is 2xlarge (8 CPU / 16384 MB).`,
    );
  }
  return tier.size;
}

function ttlFor(resolved: Resolved, options?: CreateSandboxOptions): number {
  if (!options?.timeout) return resolved.ttlSeconds;
  return Math.min(MAX_TTL_SECONDS, Math.ceil(options.timeout / 1000));
}

function fromRow(config: CocoonstackConfig, row: SandboxRow, token: string): CocoonstackSandbox {
  return {
    id: row.id,
    token,
    template: row.key.template,
    net: row.key.net,
    size: row.key.size,
    createdAt: new Date(),
    deadline: new Date(row.deadline),
    config,
  };
}

async function index(resolved: Resolved): Promise<SandboxRow[]> {
  const listing = await request<{ sandboxes: SandboxRow[] }>(resolved, resolved.apiKey, 'GET', '/v1/sandboxes');
  return listing.sandboxes;
}

/** One silkd RPC per connection: HTTP Upgrade, one JSON request line, newline-delimited frames back. */
function relay(
  sandbox: CocoonstackSandbox,
  resolved: Resolved,
  rpc: Record<string, unknown>,
  options: RelayOptions,
): Promise<Omit<CommandResult, 'durationMs'>> {
  return new Promise((fulfill, reject) => {
    const url = new URL(`${resolved.baseUrl}/v1/sandboxes/${encodeURIComponent(sandbox.id)}/agent`);
    const secure = url.protocol === 'https:';
    const client = (secure ? https : http).request(url, {
      method: 'GET',
      agent: secure ? httpsAgent : httpAgent,
      headers: { upgrade: 'silkd', connection: 'Upgrade', authorization: `Bearer ${sandbox.token}` },
    });
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        finish(() => reject(new Error(`Command timed out after ${options.timeoutMs} ms`)));
        client.destroy();
      }, options.timeoutMs);
    }
    client.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () =>
        finish(() =>
          reject(
            new CocoonstackApiError(
              response.statusCode ?? 0,
              `sandboxd agent relay refused (${response.statusCode}): ${detail(body)}`,
            ),
          ),
        ),
      );
    });
    client.on('upgrade', (_response, socket, head) => {
      const out = new StringDecoder('utf8');
      const err = new StringDecoder('utf8');
      let stdout = '';
      let stderr = '';
      let pending = head.toString('utf8');
      const handle = (frame: Frame) => {
        switch (frame.type) {
          case 'started':
            if (options.detach) {
              finish(() => fulfill({ exitCode: 0, stdout: String(frame.pid ?? ''), stderr: '' }));
              socket.destroy();
            }
            break;
          case 'stdout': {
            const text = out.write(Buffer.from(frame.data ?? '', 'base64'));
            stdout += text;
            if (text) options.onStdout?.(text);
            break;
          }
          case 'stderr': {
            const text = err.write(Buffer.from(frame.data ?? '', 'base64'));
            stderr += text;
            if (text) options.onStderr?.(text);
            break;
          }
          case 'exit':
            stdout += out.end();
            stderr += err.end();
            finish(() => fulfill({ exitCode: frame.code ?? 0, stdout, stderr }));
            socket.destroy();
            break;
          case 'error':
            finish(() => reject(new Error(`silkd ${frame.kind ?? 'error'}: ${frame.message ?? ''}`)));
            socket.destroy();
            break;
          default:
            break;
        }
      };
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        pending += chunk;
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line.trim()) {
            try {
              handle(JSON.parse(line) as Frame);
            } catch (error: unknown) {
              finish(() => reject(error instanceof Error ? error : new Error(String(error))));
              socket.destroy();
              return;
            }
          }
          newline = pending.indexOf('\n');
        }
      });
      socket.on('error', (error: Error) => finish(() => reject(error)));
      socket.on('close', () => finish(() => reject(new Error('Agent relay closed before the command exited'))));
      socket.write(`${JSON.stringify({ v: 1, ...rpc })}\n`);
    });
    client.on('error', (error: Error) => finish(() => reject(error)));
    client.end();
  });
}

/** Streaming and detached commands ride the relay; everything else is one buffered exec request. */
async function exec(sandbox: CocoonstackSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const started = performance.now();
  const resolved = resolve(sandbox.config);
  const argv = ['bash', '-c', command];
  if (options?.background || options?.onStdout || options?.onStderr) {
    const result = await relay(
      sandbox,
      resolved,
      {
        op: 'exec',
        argv,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.background ? { detach: true } : {}),
      },
      {
        timeoutMs: options.timeout ?? resolved.requestTimeoutMs,
        detach: options.background,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      },
    );
    return { ...result, durationMs: performance.now() - started };
  }
  try {
    const result = await request<ExecResponse>(
      resolved,
      sandbox.token,
      'POST',
      `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/exec`,
      {
        argv,
        ...(options?.cwd ? { cwd: options.cwd } : {}),
        ...(options?.env ? { env: options.env } : {}),
        ...(options?.timeout ? { timeout_seconds: Math.ceil(options.timeout / 1000) } : {}),
      },
      undefined,
      options?.timeout ? options.timeout + COMMAND_HTTP_TIMEOUT_BUFFER_MS : resolved.requestTimeoutMs,
    );
    return {
      exitCode: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: performance.now() - started,
    };
  } catch (error: unknown) {
    if (error instanceof CocoonstackApiError && error.status === 504) {
      throw new Error(`Command timed out after ${options?.timeout} ms`);
    }
    throw error;
  }
}

async function shell(runCommand: Exec, sandbox: CocoonstackSandbox, command: string, failure: string): Promise<string> {
  const result = await runCommand(sandbox, command);
  if (result.exitCode !== 0) {
    throw new Error(`${failure}: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
}

const provider = defineProvider<CocoonstackSandbox, CocoonstackConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config, options) => {
        const resolved = resolve(config);
        const template = options?.templateId ?? options?.image ?? resolved.template;
        const size = sizeFor(resolved, options);
        const claimed = await request<ClaimResponse>(
          resolved,
          resolved.apiKey,
          'POST',
          '/v1/claim',
          { template, net: resolved.net, size, ttl_seconds: ttlFor(resolved, options) },
          options?.signal,
        );
        if (claimed.redirect) {
          throw new Error(
            `sandboxd redirected the claim to ${claimed.redirect.join(', ')}; point baseUrl at a node that serves the pool.`,
          );
        }
        const deadline = new Date(claimed.deadline);
        rememberClaim(resolved, claimed.id, claimed.token, deadline);
        const sandbox: CocoonstackSandbox = {
          id: claimed.id,
          token: claimed.token,
          template,
          net: resolved.net,
          size,
          createdAt: new Date(),
          deadline,
          config,
        };
        return { sandbox, sandboxId: sandbox.id };
      },

      getById: async (config, sandboxId) => {
        const resolved = resolve(config);
        const token = retainedToken(resolved, sandboxId);
        if (token === undefined) return null;
        const row = (await index(resolved)).find((candidate) => candidate.id === sandboxId);
        return row ? { sandbox: fromRow(config, row, token), sandboxId } : null;
      },

      list: async (config) => {
        const resolved = resolve(config);
        return (await index(resolved)).flatMap((row) => {
          const token = retainedToken(resolved, row.id);
          return token === undefined ? [] : [{ sandbox: fromRow(config, row, token), sandboxId: row.id }];
        });
      },

      destroy: async (config, sandboxId) => {
        const resolved = resolve(config);
        try {
          await request<void>(
            resolved,
            retainedToken(resolved, sandboxId) ?? resolved.apiKey,
            'POST',
            `/v1/sandboxes/${encodeURIComponent(sandboxId)}/release`,
            undefined,
            undefined,
            resolved.requestTimeoutMs,
            'release',
          );
        } catch (error: unknown) {
          if (!(error instanceof CocoonstackApiError && error.status === 404)) throw error;
        }
        claimTokens.delete(claimKey(resolved, sandboxId));
      },

      runCommand: exec,

      streamCommand: exec,

      getInfo: async (sandbox): Promise<SandboxInfo> => ({
        id: sandbox.id,
        provider: PROVIDER,
        status: 'running',
        createdAt: sandbox.createdAt,
        timeout: Math.max(0, sandbox.deadline.getTime() - Date.now()),
        metadata: {
          template: sandbox.template,
          net: sandbox.net,
          size: sandbox.size,
          deadline: sandbox.deadline.toISOString(),
        },
      }),

      getUrl: async (sandbox, options): Promise<string> => {
        const resolved = resolve(sandbox.config);
        const preview = await request<{ url: string }>(
          resolved,
          resolved.apiKey,
          'POST',
          `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/preview`,
          { token: sandbox.token, port: options.port, ttl_seconds: 0 },
        );
        return preview.url;
      },

      filesystem: {
        readFile: async (sandbox, path, runCommand): Promise<string> =>
          shell(runCommand, sandbox, `cat "${escapeShellArg(path)}"`, `Failed to read ${path}`),

        writeFile: async (sandbox, path, content, runCommand): Promise<void> => {
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          const directory = path.slice(0, path.lastIndexOf('/')) || '/';
          await shell(
            runCommand,
            sandbox,
            `mkdir -p "${escapeShellArg(directory)}" && printf %s "${escapeShellArg(encoded)}" | base64 -d > "${escapeShellArg(path)}"`,
            `Failed to write ${path}`,
          );
        },

        mkdir: async (sandbox, path, runCommand): Promise<void> => {
          await shell(runCommand, sandbox, `mkdir -p "${escapeShellArg(path)}"`, `Failed to create ${path}`);
        },

        readdir: async (sandbox, path, runCommand): Promise<FileEntry[]> => {
          const listing = await shell(
            runCommand,
            sandbox,
            `ls -Ap --time-style=+%s -l "${escapeShellArg(path)}"`,
            `Failed to list ${path}`,
          );
          return listing
            .split('\n')
            .slice(1)
            .flatMap((line) => {
              const parts = line.trim().split(/\s+/);
              if (parts.length < 7) return [];
              const name = parts.slice(6).join(' ');
              return [
                {
                  name: name.replace(/\/$/, ''),
                  type: name.endsWith('/') ? ('directory' as const) : ('file' as const),
                  size: Number.parseInt(parts[4], 10) || 0,
                  modified: new Date(Number.parseInt(parts[5], 10) * 1000),
                },
              ];
            });
        },

        exists: async (sandbox, path, runCommand): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },

        remove: async (sandbox, path, runCommand): Promise<void> => {
          await shell(runCommand, sandbox, `rm -rf "${escapeShellArg(path)}"`, `Failed to remove ${path}`);
        },
      },

      getInstance: (sandbox) => sandbox,
    },
  },
});

/** Cocoon Stack provider; on a TLS endpoint the first call finds the HTTP/2 session already open. */
export const cocoonstack: typeof provider = (config) => {
  const baseUrl = config.baseUrl || env('COCOONSTACK_API_URL') || '';
  if (baseUrl.startsWith('https://')) session(new URL(baseUrl).origin, 'main');
  return provider(config);
};

export default cocoonstack;

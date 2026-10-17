/**
 * sandbox-cli Provider - Factory-based Implementation
 *
 * sandbox-cli runs each sandbox as a microVM with its own kernel, behind one
 * HTTP API (v1) that is the same on a Mac, on a self-hosted Linux machine and
 * in the cloud. This provider talks to that API directly with fetch, so it
 * has no SDK dependency.
 */

import { defineProvider } from '@computesdk/provider';

import type {
  CommandResult,
  InstanceInfo,
  CreateInstanceOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

/**
 * sandbox-cli provider configuration
 */
export interface SandboxCliConfig {
  /** API endpoint, e.g. `https://sandbox.example.com` - falls back to SANDBOX_ENDPOINT */
  endpoint?: string;
  /** Bearer token - falls back to SANDBOX_TOKEN */
  token?: string;
  /** On a gateway, the organization to act in - falls back to SANDBOX_ORG */
  org?: string;
  /** Default sandbox lifetime in milliseconds; unset leaves the server's default */
  timeout?: number;
}

/** A sandbox as the v1 API returns it (the fields this provider reads). */
interface ApiSandbox {
  id: string;
  name?: string;
  state: 'pending' | 'running' | 'suspended' | 'terminated';
  image: string;
  cpus: number;
  memory_mb: number;
  created_at: string;
  lifetime_secs?: number;
  labels?: Record<string, string>;
}

/** The native instance: the API record plus a client bound to it. */
export interface SandboxCliInstance {
  client: ApiClient;
  sandbox: ApiSandbox;
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(`sandbox-cli: ${code} (${status}): ${message}`);
  }
}

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function fromB64(s: string | null | undefined): string {
  return s ? Buffer.from(s, 'base64').toString('utf8') : '';
}

/** `URL.hostname` of a loopback address: 127.0.0.0/8, [::1] or localhost. */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);
}

class ApiClient {
  readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(config: SandboxCliConfig) {
    const endpoint = config.endpoint || env('SANDBOX_ENDPOINT');
    const token = config.token || env('SANDBOX_TOKEN');
    if (!endpoint) {
      throw new Error(
        `Missing sandbox-cli endpoint. Provide 'endpoint' in config or set SANDBOX_ENDPOINT ` +
          `(the URL of a sandboxd or a gateway, e.g. https://sandbox.example.com).`
      );
    }
    if (!token) {
      throw new Error(`Missing sandbox-cli token. Provide 'token' in config or set SANDBOX_TOKEN.`);
    }
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error(`sandbox-cli endpoint must be http(s)://host[:port], got ${endpoint}`);
    }
    // Every request carries the bearer token, so plain http is only for a
    // sandboxd on this machine.
    if (u.protocol === 'http:' && !isLoopback(u.hostname)) {
      throw new Error(
        `sandbox-cli endpoint ${endpoint} is plain http to a non-loopback host, which would send the token ` +
          `unencrypted. Use https://, or http:// only to 127.0.0.1, ::1 or localhost.`
      );
    }
    this.base = endpoint.replace(/\/+$/, '');
    this.headers = { Authorization: `Bearer ${token}` };
    const org = config.org || env('SANDBOX_ORG');
    if (org) this.headers['X-Sandbox-Org'] = org;
  }

  async request(
    method: string,
    path: string,
    init: { query?: Record<string, string>; json?: unknown; body?: BodyInit; signal?: AbortSignal } = {}
  ): Promise<Response> {
    let url = this.base + path;
    if (init.query) url += '?' + new URLSearchParams(init.query).toString();
    const headers: Record<string, string> = { ...this.headers };
    let body = init.body;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/octet-stream';
    }
    const resp = await fetch(url, { method, headers, body, signal: init.signal });
    if (!resp.ok) {
      const text = await resp.text();
      let code = 'internal';
      let message = text.trim();
      try {
        const e = JSON.parse(text).error;
        code = e.code ?? code;
        message = e.message ?? message;
      } catch {
        // not a JSON error body
      }
      throw new ApiError(resp.status, code, message);
    }
    return resp;
  }

  async json<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const resp = await this.request(method, path, payload === undefined ? {} : { json: payload });
    const text = await resp.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  sbx(id: string): string {
    return '/v1/sandboxes/' + encodeURIComponent(id);
  }
}

/** First defined number among the generic resource option spellings. */
function pick(...vals: Array<number | undefined>): number | undefined {
  return vals.find((v) => typeof v === 'number' && Number.isFinite(v));
}

/** The v1 `/run` call: `command` goes through `sh -c`, as ComputeSDK commands are shell strings. */
async function run(instance: SandboxCliInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const { client, sandbox } = instance;
  const startTime = Date.now();
  const req: Record<string, unknown> = { argv: ['sh', '-c', command] };
  if (options?.cwd) req.cwd = options.cwd;
  if (options?.env && Object.keys(options.env).length > 0) req.env = options.env;

  if (options?.background) {
    // A background process keeps running after this returns; its output stays
    // readable through the API's process list.
    await client.json('POST', client.sbx(sandbox.id) + '/processes', req);
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
  }

  if (options?.timeout) req.timeout_secs = Math.max(1, Math.ceil(options.timeout / 1000));
  const r = await client.json<{ exit_code: number; stdout: string; stderr: string; timed_out: boolean }>(
    'POST',
    client.sbx(sandbox.id) + '/run',
    req
  );
  return {
    stdout: fromB64(r.stdout),
    stderr: fromB64(r.stderr),
    exitCode: r.timed_out && r.exit_code === 0 ? -1 : r.exit_code,
    durationMs: Date.now() - startTime,
  };
}

/** How long after a timeout's KILL the output stream may take to end. */
const KILL_GRACE_MS = 2_000;

/**
 * Live output through the API's own process stream: start the process, then
 * read `GET …/processes/{pid}/output`, one JSON object per line, until the
 * `{"exit_code": N}` line.
 *
 * A timeout sends KILL, which ends the stream once it lands (the guest kills
 * the whole process group). The output request has a deadline of its own as
 * well, so a kill that fails cannot leave the caller waiting on a command
 * that is still running. Any other failure - the output request, a read, a
 * callback - kills the process before the error is reported, so nothing is
 * left running without a reader.
 */
async function stream(instance: SandboxCliInstance, command: string, options: RunCommandOptions): Promise<CommandResult> {
  const { client, sandbox } = instance;
  const startTime = Date.now();
  const req: Record<string, unknown> = { argv: ['sh', '-c', command] };
  if (options.cwd) req.cwd = options.cwd;
  if (options.env && Object.keys(options.env).length > 0) req.env = options.env;

  const proc = await client.json<{ pid: number }>('POST', client.sbx(sandbox.id) + '/processes', req);
  const procPath = `${client.sbx(sandbox.id)}/processes/${proc.pid}`;
  const kill = () => client.json('POST', procPath + '/signal', { signal: 'KILL' }).catch(() => {});

  const abort = new AbortController();
  let timedOut = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const timer = options.timeout
    ? setTimeout(() => {
        timedOut = true;
        void kill();
        grace = setTimeout(() => abort.abort(), KILL_GRACE_MS);
      }, options.timeout)
    : undefined;

  // Output arrives in byte chunks that can split a character, so each stream
  // keeps one decoder across events and is flushed at the end.
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const out = { stdout: '', stderr: '' };
  const emit = (s: 'stdout' | 'stderr', text: string) => {
    if (!text) return;
    out[s] += text;
    (s === 'stdout' ? options.onStdout : options.onStderr)?.(text);
  };

  let exitCode: number | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const resp = await client.request('GET', procPath + '/output', { signal: abort.signal });
    if (!resp.body) throw new Error('sandbox-cli: output stream has no body');
    reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as { stream?: 'stdout' | 'stderr'; data?: string; exit_code?: number };
        if (typeof ev.exit_code === 'number') {
          exitCode = ev.exit_code;
        } else if (ev.stream === 'stdout' || ev.stream === 'stderr') {
          emit(ev.stream, decoders[ev.stream].decode(Buffer.from(ev.data ?? '', 'base64'), { stream: true }));
        }
      }
    }
  } catch (error) {
    if (!(timedOut && abort.signal.aborted)) {
      if (exitCode === undefined) await kill();
      throw error;
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(grace);
    reader?.cancel().catch(() => {});
  }
  emit('stdout', decoders.stdout.decode());
  emit('stderr', decoders.stderr.decode());

  if (exitCode === undefined || (timedOut && exitCode === 0)) exitCode = -1;
  return { stdout: out.stdout, stderr: out.stderr, exitCode, durationMs: Date.now() - startTime };
}

/**
 * Create a sandbox-cli provider instance using the factory pattern
 */
export const sandboxCli = defineProvider<SandboxCliInstance, SandboxCliConfig>({
  name: 'sandbox-cli',
  methods: {
    instances: {
      create: async (config: SandboxCliConfig, options?: CreateInstanceOptions) => {
        const client = new ApiClient(config);
        const o = options || {};

        // POST /v1/sandboxes returns once the VM is booted and running, so the
        // sandbox is usable as soon as this resolves.
        const req: Record<string, unknown> = {};
        const image = o.image || o.templateId;
        if (image) req.image = image;
        if (o.snapshotId) req.snapshot_id = o.snapshotId;
        if (o.name) req.name = o.name;
        if (o.envs && Object.keys(o.envs).length > 0) req.env = o.envs;
        if (o.metadata && Object.keys(o.metadata).length > 0) {
          req.labels = Object.fromEntries(Object.entries(o.metadata).map(([k, v]) => [k, String(v)]));
        }
        const cpus = pick(o.cpus, o.vcpus, o.cpu);
        if (cpus !== undefined) req.cpus = cpus;
        const memoryMb = pick(o.memoryMb, o.memory, o.memoryMiB, o.memMiB);
        if (memoryMb !== undefined) req.memory_mb = memoryMb;
        const diskMb = pick(o.diskMb, o.diskMiB);
        if (diskMb !== undefined) req.disk_mb = diskMb;
        const lifetimeMs = o.timeout ?? config.timeout;
        if (lifetimeMs) req.lifetime_secs = Math.max(1, Math.ceil(lifetimeMs / 1000));

        try {
          const sandbox = await client.json<ApiSandbox>('POST', '/v1/sandboxes', req);
          return { instance: { client, sandbox }, instanceId: sandbox.id };
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            throw new Error(`sandbox-cli authentication failed. Check your SANDBOX_TOKEN.`);
          }
          throw new Error(
            `Failed to create sandbox-cli sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: SandboxCliConfig, sandboxId: string) => {
        const client = new ApiClient(config);
        try {
          const sandbox = await client.json<ApiSandbox>('GET', client.sbx(sandboxId));
          if (sandbox.state === 'terminated') return null;
          return { instance: { client, sandbox }, instanceId: sandbox.id };
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      },

      list: async (config: SandboxCliConfig) => {
        const client = new ApiClient(config);
        const { sandboxes } = await client.json<{ sandboxes: ApiSandbox[] }>('GET', '/v1/sandboxes');
        return (sandboxes ?? [])
          .filter((s) => s.state !== 'terminated')
          .map((sandbox) => ({ instance: { client, sandbox }, instanceId: sandbox.id }));
      },

      destroy: async (config: SandboxCliConfig, sandboxId: string) => {
        const client = new ApiClient(config);
        try {
          await client.json('DELETE', client.sbx(sandboxId));
        } catch (error) {
          // Idempotent: the sandbox may already be gone.
          if (error instanceof ApiError && error.status === 404) return;
          throw error;
        }
      },

      runCommand: run,

      streamCommand: stream,

      getInfo: async (instance: SandboxCliInstance): Promise<InstanceInfo> => {
        const { client, sandbox } = instance;
        const s = await client.json<ApiSandbox>('GET', client.sbx(sandbox.id));
        return {
          id: s.id,
          provider: 'sandbox-cli',
          // A pending sandbox is still being created and refuses commands; its
          // native state stays in metadata.
          status: s.state === 'running' ? 'running' : 'stopped',
          createdAt: new Date(s.created_at),
          timeout: (s.lifetime_secs ?? 0) * 1000,
          metadata: { state: s.state, image: s.image, cpus: s.cpus, memoryMb: s.memory_mb, name: s.name, labels: s.labels },
        };
      },

      getUrl: async (): Promise<string> => {
        // A port is reached through the API's tunnel (an upgraded connection to
        // the guest's own loopback), never through a public URL.
        throw new Error(
          'sandbox-cli does not expose sandbox ports as URLs. Use `sandbox-cli tunnel` or the API tunnel endpoint.'
        );
      },

      filesystem: {
        readFile: async (instance: SandboxCliInstance, path: string): Promise<string> => {
          const { client, sandbox } = instance;
          const resp = await client.request('GET', client.sbx(sandbox.id) + '/files', { query: { path } });
          return await resp.text();
        },

        writeFile: async (instance: SandboxCliInstance, path: string, content: string): Promise<void> => {
          // The API creates parent directories.
          const { client, sandbox } = instance;
          await client.request('PUT', client.sbx(sandbox.id) + '/files', { query: { path }, body: content });
        },

        mkdir: async (instance: SandboxCliInstance, path: string): Promise<void> => {
          const r = await run(instance, `mkdir -p -- ${shellQuote(path)}`);
          if (r.exitCode !== 0) throw new Error(`Failed to create directory ${path}: ${r.stderr}`);
        },

        readdir: async (instance: SandboxCliInstance, path: string): Promise<FileEntry[]> => {
          const { client, sandbox } = instance;
          const resp = await client.request('GET', client.sbx(sandbox.id) + '/dirs', { query: { path } });
          const { entries } = (await resp.json()) as { entries: Array<{ name: string; type: 'file' | 'dir'; size: number }> };
          return (entries ?? []).map((e) => ({
            name: e.name,
            type: e.type === 'dir' ? ('directory' as const) : ('file' as const),
            size: e.size,
          }));
        },

        exists: async (instance: SandboxCliInstance, path: string): Promise<boolean> => {
          const r = await run(instance, `test -e ${shellQuote(path)}`);
          return r.exitCode === 0;
        },

        remove: async (instance: SandboxCliInstance, path: string): Promise<void> => {
          // The API's DELETE removes only a file or an empty directory;
          // ComputeSDK's remove is recursive.
          const r = await run(instance, `rm -rf -- ${shellQuote(path)}`);
          if (r.exitCode !== 0) throw new Error(`Failed to remove ${path}: ${r.stderr}`);
        },
      },
    },
  },
});

/** Single-quotes a value for `sh -c`, safe for any byte sequence. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

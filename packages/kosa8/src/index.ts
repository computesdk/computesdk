/**
 * kosa8 Provider - Factory-based Implementation
 *
 * Sandboxes on kosa8 Cloud (https://kosa8.com). Each sandbox runs in its own microVM with its
 * own kernel. The cloud API is a small JSON surface, so this package talks to it with `fetch`
 * and has no SDK dependency.
 *
 * Commands go through the buffered exec endpoint: straight to the sandbox's host when the create
 * answer carries a direct-exec URL and token (see runDirect), otherwise through the API. File operations run as shell commands over
 * that exec (ComputeSDK's shell filesystem; no native file API is used here), and `pause()`/`resume()` map
 * to kosa8's sleep and wake, which snapshot the VM's memory and disk and restore it.
 */

import { randomBytes } from 'node:crypto';
import { defineProvider, escapeShellArg, ShellFileSystem } from '@computesdk/provider';
import { httpRequest, preconnect } from './transport';

import type { CommandResult, CreateInstanceOptions, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

export interface Kosa8Config {
  /** kosa8 Cloud API key - if not provided, will fallback to KOSA8_API_KEY environment variable */
  apiKey?: string;
  /** API base URL - if not provided, will fallback to KOSA8_API_URL, then https://api.kosa8.com */
  baseUrl?: string;
  /** Default template for new sandboxes - falls back to KOSA8_TEMPLATE, then the org's default (`base`) */
  template?: string;
  /** Default region for new sandboxes, e.g. `eu-hel1` - falls back to KOSA8_REGION, then any region */
  region?: string;
}

/** A sandbox as the kosa8 Cloud API returns it. */
export interface Kosa8SandboxData {
  id: string;
  state: string;
  template: string;
  cpus: number;
  mem_mb: number;
  region: string | null;
  created_at: number;
  started_at: number | null;
  sleep_after_s: number | null;
  delete_after: number | null;
  last_error: string | null;
  [key: string]: unknown;
}

/** A template as GET /v1/templates returns it. */
export interface Kosa8Template {
  key: string;
  cpus: number;
  mem_mb: number;
  image?: string;
  regions: string[];
  [key: string]: unknown;
}

/** The create answer's `direct` object: the host's exec endpoint for this sandbox and a token for it. */
export interface Kosa8Direct {
  exec_url: string;
  token: string;
  /** When the token stops working, ms since the epoch. */
  expires_at: number;
}

export interface Kosa8Sandbox {
  id: string;
  data: Kosa8SandboxData;
  apiKey: string;
  baseUrl: string;
  /** Present while commands can go straight to the sandbox's host (runDirect). */
  direct?: Kosa8Direct;
  /** A fresh direct token being fetched (refreshDirect). */
  refreshing?: Promise<void>;
}

interface Auth {
  apiKey: string;
  baseUrl: string;
}

interface ExecResponse {
  exit: number | null;
  stdout: string;
  stderr: string;
}

/** The API's shortest and longest lifetime for a sandbox (ttl_s). */
const MIN_TTL_S = 60;
const MAX_TTL_S = 90 * 86400;

/** Exit code reported when `runCommand`'s timeout stops a command (as coreutils `timeout` does). */
const TIMEOUT_EXIT = 124;

/** Names the marker file a timed command creates once it returns (see execArgv). */
const DONE_ENV = 'KOSA8_DONE';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Create options that kosa8 cannot honour: a template fixes the size and image. */
const UNSUPPORTED_CREATE_OPTIONS = [
  'cpu', 'cpus', 'vcpus', 'cpuLimit', 'memory', 'memoryMiB', 'memMiB', 'memoryMb', 'diskMb', 'diskMiB',
  'image', 'snapshotId', 'envs', 'volumes',
] as const;

function resolveConfig(config: Kosa8Config): Auth {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const apiKey = config.apiKey || env?.KOSA8_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      `Missing kosa8 API key. Provide 'apiKey' in config or set the KOSA8_API_KEY environment variable. ` +
        `Create a key in the kosa8 Cloud dashboard at https://app.kosa8.com`,
    );
  }
  const baseUrl = (config.baseUrl || env?.KOSA8_API_URL || 'https://api.kosa8.com').replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

async function request<T>(
  auth: Auth,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T | null> {
  const res = await httpRequest(`${auth.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (res.status === 404) return null;
  const text = res.text;
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      if (parsed && (parsed.error || parsed.message)) detail = [parsed.error, parsed.message].filter(Boolean).join(': ');
    } catch {
      // Not JSON: keep the raw text.
    }
    throw new Error(`kosa8 API error (${res.status}) on ${method} ${path}: ${detail}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

const sandboxPath = (id: string, rest = '') => `/v1/sandboxes/${encodeURIComponent(id)}${rest}`;

function toSandbox(auth: Auth, data: Kosa8SandboxData, direct?: unknown): Kosa8Sandbox {
  const sandbox: Kosa8Sandbox = { id: data.id, data, apiKey: auth.apiKey, baseUrl: auth.baseUrl };
  if (isDirect(direct)) {
    sandbox.direct = direct;
    // The first command follows at once: its host's session opens now.
    preconnect(direct.exec_url);
  }
  return sandbox;
}

function isDirect(d: unknown): d is Kosa8Direct {
  const x = d as Kosa8Direct | null | undefined;
  return !!x && typeof x.exec_url === 'string' && /^https:\/\//.test(x.exec_url) && typeof x.token === 'string' &&
    typeof x.expires_at === 'number';
}

/** A direct token this close to expiry is not used; one closer than DIRECT_REFRESH_MS is renewed in the background. */
const DIRECT_MARGIN_MS = 15_000;
const DIRECT_REFRESH_MS = 60_000;

/**
 * Statuses from the direct endpoint that mean the command did not run there: the token was refused
 * (401, 403), the host does not have the sandbox (404), it is asleep and only the API wakes it
 * (409), the host does not offer it (501), or Cloudflare could not reach the host (521, 522, 523,
 * 530). The command is then sent through the API. Any other failure is reported as is, since the
 * command may have run.
 */
const DIRECT_NOT_RUN = new Set([401, 403, 404, 409, 501, 521, 522, 523, 530]);

/** Renews the direct token in the background; a failure leaves the API path in use. */
function refreshDirect(sandbox: Kosa8Sandbox): void {
  if (sandbox.refreshing) return;
  sandbox.refreshing = request<{ direct?: unknown }>(sandbox, 'POST', sandboxPath(sandbox.id, '/direct'))
    .then((r) => {
      if (isDirect(r?.direct)) sandbox.direct = r.direct;
    })
    .catch(() => {})
    .finally(() => {
      sandbox.refreshing = undefined;
    });
}

/**
 * Runs a command on the sandbox's host directly (the create answer's `direct`), skipping the API's
 * hop. Returns null when the command was not run there, so the caller sends it through the API;
 * the sandbox then stops using the direct path until a fresh token arrives.
 */
async function runDirect(sandbox: Kosa8Sandbox, body: unknown, signal?: AbortSignal): Promise<ExecResponse | null> {
  const d = sandbox.direct;
  if (!d) return null;
  const left = d.expires_at - Date.now();
  if (left < DIRECT_REFRESH_MS) refreshDirect(sandbox);
  if (left < DIRECT_MARGIN_MS) return null;
  const res = await httpRequest(d.exec_url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const text = res.text;
  if (DIRECT_NOT_RUN.has(res.status)) {
    if (sandbox.direct === d) sandbox.direct = undefined;
    return null;
  }
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) detail = parsed.error;
    } catch {
      // Not JSON: keep the raw text.
    }
    throw new Error(`kosa8 host error (${res.status}) on exec in ${sandbox.id}: ${detail}`);
  }
  return JSON.parse(text) as ExecResponse;
}

/** Maps ComputeSDK's create options onto the body of POST /v1/sandboxes. */
export function createBody(config: Kosa8Config, options: CreateInstanceOptions = {}): Record<string, unknown> {
  for (const key of UNSUPPORTED_CREATE_OPTIONS) {
    if (options[key] !== undefined) {
      throw new Error(
        `kosa8 does not support the '${key}' create option. A sandbox's size and image come from its template; ` +
          `pick one with 'templateId' (list them with provider.template.list()).`,
      );
    }
  }
  const body: Record<string, unknown> = {};
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const template = options.templateId ?? config.template ?? (env?.KOSA8_TEMPLATE || undefined);
  if (template) body.template = template;
  const region = typeof options.region === 'string' ? options.region : (config.region ?? (env?.KOSA8_REGION || undefined));
  if (region) body.region = region;
  if (options.sleepAfterSeconds !== undefined) body.sleep_after_s = options.sleepAfterSeconds;
  if (typeof options.timeout === 'number' && options.timeout > 0) {
    // kosa8 deletes the sandbox when its lifetime ends; the API's shortest lifetime is 60 s.
    body.ttl_s = Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, Math.ceil(options.timeout / 1000)));
  }
  return body;
}

/** Builds the argv for POST /v1/sandboxes/{id}/exec from a shell command string. */
export function execArgv(command: string, options?: RunCommandOptions): string[] {
  let cmd = command;
  if (options?.cwd) cmd = `cd "${escapeShellArg(options.cwd)}" && ${cmd}`;
  if (options?.background) {
    cmd = `nohup sh -c "${escapeShellArg(cmd)}" >/dev/null 2>&1 &`;
  } else if (options?.timeout && options.timeout > 0) {
    // Stop the command in the sandbox, not just the wait for it. GNU timeout signals the whole
    // process group; an image without `timeout` runs the command unbounded and the request's
    // own deadline (runCommand) still applies.
    //
    // Status 137 alone does not mean the deadline passed: the command may exit 137 itself or be
    // killed early. The command runs in a subshell and a marker file is created once it returns,
    // whatever its status. Only a 137 with no marker (the shell itself was killed) once the
    // deadline has passed (whole seconds: the elapsed count cannot fall short of a real deadline)
    // is reported as a timeout.
    const seconds = Math.max(1, Math.ceil(options.timeout / 1000));
    const plain = `sh -c "${escapeShellArg(cmd)}"`;
    const marked = `sh -c "${escapeShellArg(`(\n${cmd}\n); s=$?; : > "$${DONE_ENV}"; exit $s`)}"`;
    cmd =
      `if command -v timeout >/dev/null 2>&1 && ${DONE_ENV}=$(mktemp 2>/dev/null); then ` +
      `rm -f "$${DONE_ENV}"; export ${DONE_ENV}; t0=$(date +%s); timeout -s KILL ${seconds} ${marked}; s=$?; ` +
      `if [ $s -eq 137 ] && [ ! -e "$${DONE_ENV}" ] && [ $(( $(date +%s) - t0 )) -ge ${seconds} ]; then s=${TIMEOUT_EXIT}; fi; ` +
      `rm -f "$${DONE_ENV}"; exit $s; ` +
      `else ${plain}; fi`;
  }
  return ['sh', '-c', cmd];
}

/**
 * The exec API's limit on each argv entry. Measured in UTF-8 bytes here, which is never less than
 * the API's own count, so a command with multibyte characters cannot slip over it.
 */
const MAX_ARG_BYTES = 8192;

/** The exec API's limit on the whole request body, in bytes. */
export const MAX_EXEC_BODY_BYTES = 64 * 1024;

/** Environment variable that carries a script too long for one argv entry; callers may not set it. */
export const SCRIPT_ENV = 'KOSA8_SCRIPT';

/**
 * The exec request body: a script too long for one argv entry travels in an environment variable.
 * Throws before any request is made when the serialized body would exceed the exec API's limit.
 */
export function execBody(command: string, options?: RunCommandOptions): { cmd: string[]; env: string[] } {
  const argv = execArgv(command, options);
  const env = execEnv(options?.env);
  const body = Buffer.byteLength(argv[2], 'utf8') <= MAX_ARG_BYTES
    ? { cmd: argv, env }
    : { cmd: ['sh', '-c', `eval "$${SCRIPT_ENV}"`], env: [...env, `${SCRIPT_ENV}=${argv[2]}`] };
  const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (size > MAX_EXEC_BODY_BYTES) {
    throw new Error(
      `kosa8 exec request is ${size} bytes, over the exec API's limit of ${MAX_EXEC_BODY_BYTES} bytes (64 KiB) ` +
        `for the command and its environment together. Write a long script to a file with ` +
        `sandbox.filesystem.writeFile() and run that file instead.`,
    );
  }
  return body;
}

function execEnv(env?: Record<string, string>): string[] {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => {
    if (!ENV_NAME.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    if (key === SCRIPT_ENV) {
      throw new Error(`The environment variable name ${SCRIPT_ENV} is reserved by the kosa8 provider; use another name.`);
    }
    return `${key}=${value}`;
  });
}

function infoStatus(state: string): InstanceInfo['status'] {
  if (state === 'error') return 'error';
  if (state === 'running') return 'running';
  // creating, sleeping, paused, stopped and deleted: not running now, so a readiness check keeps waiting.
  // A sleeping sandbox wakes on its next command.
  return 'stopped';
}

async function getData(sandbox: Kosa8Sandbox): Promise<Kosa8SandboxData | null> {
  const data = await request<{ sandbox: Kosa8SandboxData }>(sandbox, 'GET', sandboxPath(sandbox.id));
  return data?.sandbox ?? null;
}

type ExecRunner = (sandbox: Kosa8Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

/**
 * Base64 characters per write. The exec API caps each argv entry at 8192 characters, too small
 * for the shell filesystem's inline chunks, so file content travels in an environment variable,
 * which counts only toward the 64 KiB request body.
 */
export const WRITE_CHUNK_CHARS = 32 * 1024;

const shellFs = (sandbox: Kosa8Sandbox, run: ExecRunner) =>
  new ShellFileSystem((command, options) => run(sandbox, command, options));

async function mustSucceed(run: ExecRunner, sandbox: Kosa8Sandbox, command: string, path: string, env?: Record<string, string>) {
  const result = await run(sandbox, command, env ? { env } : undefined);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`write '${path}' failed (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`);
  }
}

/** Writes a file through exec: base64 chunks into a temporary file beside it, then an atomic rename. */
export async function writeFileViaExec(sandbox: Kosa8Sandbox, path: string, content: string, run: ExecRunner): Promise<void> {
  const target = `"${escapeShellArg(path)}"`;
  const tmp = `"${escapeShellArg(`${path}.computesdk-${randomBytes(6).toString('hex')}`)}"`;
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += WRITE_CHUNK_CHARS) chunks.push(encoded.slice(i, i + WRITE_CHUNK_CHARS));
  try {
    await mustSucceed(run, sandbox, `d=$(dirname ${target}) && mkdir -p "$d" && : > ${tmp}`, path);
    for (const chunk of chunks) {
      await mustSucceed(run, sandbox, `printf '%s' "$KOSA8_CHUNK" | base64 -d >> ${tmp}`, path, { KOSA8_CHUNK: chunk });
    }
    await mustSucceed(run, sandbox, `mv -f ${tmp} ${target}`, path);
  } catch (err) {
    await run(sandbox, `rm -f ${tmp}`).catch(() => {});
    throw err;
  }
}

const notAvailable = (what: string) =>
  new Error(`kosa8 does not support ${what} through ComputeSDK yet.`);

const provider = defineProvider<Kosa8Sandbox, Kosa8Config>({
  name: 'kosa8',
  methods: {
    instances: {
      create: async (config: Kosa8Config, options?: CreateInstanceOptions) => {
        const auth = resolveConfig(config);
        const data = await request<{ sandbox: Kosa8SandboxData; direct?: unknown }>(
          auth,
          'POST',
          '/v1/sandboxes',
          createBody(config, options),
          options?.signal,
        );
        if (!data?.sandbox) throw new Error('kosa8 API returned no sandbox on create');
        return { instance: toSandbox(auth, data.sandbox, data.direct), instanceId: data.sandbox.id };
      },

      getById: async (config: Kosa8Config, instanceId: string) => {
        const auth = resolveConfig(config);
        const data = await request<{ sandbox: Kosa8SandboxData }>(auth, 'GET', sandboxPath(instanceId));
        return data?.sandbox ? { instance: toSandbox(auth, data.sandbox), instanceId: data.sandbox.id } : null;
      },

      list: async (config: Kosa8Config) => {
        const auth = resolveConfig(config);
        const data = await request<{ sandboxes: Kosa8SandboxData[] }>(auth, 'GET', '/v1/sandboxes');
        return (data?.sandboxes ?? []).map((row) => ({ instance: toSandbox(auth, row), instanceId: row.id }));
      },

      destroy: async (config: Kosa8Config, instanceId: string) => {
        const auth = resolveConfig(config);
        // A sandbox that is already gone answers 404, which request() returns as null.
        await request(auth, 'DELETE', sandboxPath(instanceId));
      },

      runCommand: async (sandbox: Kosa8Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const body = execBody(command, options);
        // The command is stopped in the sandbox at the deadline; the request gets a grace period on top.
        const signal = options?.timeout && options.timeout > 0 && !options.background
          ? AbortSignal.timeout(options.timeout + 30_000)
          : undefined;
        const data = (await runDirect(sandbox, body, signal)) ??
          (await request<ExecResponse>(sandbox, 'POST', sandboxPath(sandbox.id, '/exec'), body, signal));
        if (!data) throw new Error(`kosa8 sandbox ${sandbox.id} not found`);
        return {
          stdout: data.stdout ?? '',
          stderr: data.stderr ?? '',
          exitCode: Number.isInteger(data.exit) ? (data.exit as number) : -1,
          durationMs: Date.now() - start,
        };
      },

      getInfo: async (sandbox: Kosa8Sandbox): Promise<InstanceInfo> => {
        const current = (await getData(sandbox)) ?? { ...sandbox.data, state: 'deleted' };
        sandbox.data = current;
        return {
          id: sandbox.id,
          provider: 'kosa8',
          status: infoStatus(current.state),
          createdAt: new Date(current.created_at),
          timeout: current.delete_after ? Math.max(0, current.delete_after - Date.now()) : 0,
          metadata: {
            state: current.state,
            template: current.template,
            cpus: current.cpus,
            memMb: current.mem_mb,
            region: current.region,
            sleepAfterSeconds: current.sleep_after_s,
            deleteAfter: current.delete_after,
            lastError: current.last_error,
          },
        };
      },

      getUrl: async (): Promise<string> => {
        throw notAvailable('port URLs');
      },

      // Sleep snapshots the VM (memory and disk) and frees its RAM; wake restores it.
      pause: async (sandbox: Kosa8Sandbox): Promise<void> => {
        const data = await request<{ sandbox: Kosa8SandboxData }>(sandbox, 'POST', sandboxPath(sandbox.id, '/sleep'));
        if (!data) throw new Error(`kosa8 sandbox ${sandbox.id} not found`);
        sandbox.data = data.sandbox;
      },

      resume: async (sandbox: Kosa8Sandbox): Promise<void> => {
        const data = await request<{ sandbox: Kosa8SandboxData }>(sandbox, 'POST', sandboxPath(sandbox.id, '/wake'));
        if (!data) throw new Error(`kosa8 sandbox ${sandbox.id} not found`);
        sandbox.data = data.sandbox;
      },

      pauseCapabilities: { memory: true },

      // No default lifetime: a sandbox lives until it is destroyed, unless created with `timeout`.
      lifetime: {},

      // Moves the sandbox's delete time later by `ms`. A sandbox with no delete time has no limit to extend.
      extendLifetime: async (sandbox: Kosa8Sandbox, ms: number): Promise<void> => {
        const current = await getData(sandbox);
        if (!current) throw new Error(`kosa8 sandbox ${sandbox.id} not found`);
        sandbox.data = current;
        if (current.delete_after == null) return;
        const deleteAfter = Math.min(Math.max(current.delete_after, Date.now()) + ms, Date.now() + MAX_TTL_S * 1000);
        const data = await request<{ sandbox: Kosa8SandboxData }>(sandbox, 'PATCH', sandboxPath(sandbox.id), {
          delete_after: Math.floor(deleteAfter),
        });
        // A 404 here means the sandbox was deleted between the read and the update.
        if (!data) throw new Error(`kosa8 sandbox ${sandbox.id} not found`);
        if (data.sandbox) sandbox.data = data.sandbox;
      },

      getInstance: (sandbox: Kosa8Sandbox): Kosa8Sandbox => sandbox,

      // Shell commands over exec. kosa8's own file API needs a host capability that is not on
      // every host yet, so it is not used here.
      filesystem: {
        readFile: (sandbox, path, run) => shellFs(sandbox, run).readFile(path),
        writeFile: (sandbox, path, content, run) => writeFileViaExec(sandbox, path, content, run),
        mkdir: (sandbox, path, run) => shellFs(sandbox, run).mkdir(path),
        readdir: (sandbox, path, run) => shellFs(sandbox, run).readdir(path),
        exists: (sandbox, path, run) => shellFs(sandbox, run).exists(path),
        remove: (sandbox, path, run) => shellFs(sandbox, run).remove(path),
      },
    },

    template: {
      create: async () => {
        throw notAvailable('creating templates (templates are offered by the hosts)');
      },
      list: async (config: Kosa8Config): Promise<Kosa8Template[]> => {
        const auth = resolveConfig(config);
        const data = await request<{ templates: Kosa8Template[] }>(auth, 'GET', '/v1/templates');
        return data?.templates ?? [];
      },
      delete: async () => {
        throw notAvailable('deleting templates (templates are offered by the hosts)');
      },
    },
  },
});

/**
 * The kosa8 provider. Configuring it opens the HTTP/2 session to the API (transport.ts), so the
 * first create does not pay the connection's handshake.
 */
export const kosa8: typeof provider = (config) => {
  try {
    preconnect(resolveConfig(config).baseUrl);
  } catch {
    // No key yet: the first call reports it.
  }
  return provider(config);
};

export default kosa8;

/**
 * Orble Provider - Factory-based Implementation
 *
 * Linux VMs ("boxes") on Orble (https://orble.tech), with root through passwordless sudo and Docker inside. Orble's
 * REST API is a small JSON surface, so this package talks to it with `fetch` and has no SDK dependency.
 *
 * Commands run as the box's user, `agent`, from /home/agent. Files are read and written through the API's files
 * endpoint; mkdir, readdir, exists and remove run as shell commands.
 */

import { defineProvider, escapeShellArg, InstanceSizeError } from '@computesdk/provider';

import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  FileEntry,
  InstanceInfo,
  ListSnapshotsOptions,
  ListTemplatesOptions,
  RunCommandOptions,
} from '@computesdk/provider';
import type { Snapshot } from 'computesdk';

export interface OrbleConfig {
  /** Orble API key - if not provided, will fallback to ORBLE_API_KEY environment variable */
  apiKey?: string;
  /** API base URL - if not provided, will fallback to ORBLE_API_URL, then https://orble.tech */
  baseUrl?: string;
  /**
   * Who commands and file operations run as: `root` (the default, as on Daytona and Modal; relative paths start at
   * /root) or `agent`, the box's own user (relative paths start at /home/agent, where SSH logins and agents work).
   * Falls back to ORBLE_USER. A command's own `user` option overrides it.
   */
  user?: OrbleUser;
}

export type OrbleUser = 'agent' | 'root';

/** A box as Orble's API returns it. */
export interface OrbleBoxData {
  name: string;
  hostname: string;
  state: string;
  vcpus: number;
  mem_mib: number;
  disk_gib: number;
  created_at?: string;
  [key: string]: unknown;
}

export interface OrbleSandbox {
  id: string;
  data: OrbleBoxData;
  apiKey: string;
  baseUrl: string;
  user?: OrbleUser;
}

/** A snapshot as Orble's API returns it. `gallery` marks one of Orble's own, which every account can start boxes from. */
export interface OrbleSnapshotData {
  name: string;
  alias?: string;
  box?: string;
  state: string;
  vcpus: number;
  mem_mib: number;
  disk_bytes?: number;
  created_at: string;
  gallery?: boolean;
  about?: string;
}

interface ExecResponse {
  running?: boolean;
  job?: string;
  exit_code: number;
  stdout?: string;
  stderr?: string;
}

type FsRunCommand = (sandbox: OrbleSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

// Orble's box sizes (vCPU / MiB): micro 1/2048, s 2/4096, m 4/8192, l 8/16384, each with a 64 GiB disk.
// https://orble.tech/pricing
const ORBLE_DISK_MIB = 65536;

export const ORBLE_SIZES: Readonly<Record<string, { size: 'micro' | 's' | 'm' | 'l'; vcpus: number; memoryMiB: number }>> = Object.freeze({
  xs: { size: 'micro', vcpus: 1, memoryMiB: 2048 }, // memory is a floor, so the 1 vCPU / 2 GiB shape is also an xs
  sm: { size: 'micro', vcpus: 1, memoryMiB: 2048 },
  md: { size: 's', vcpus: 2, memoryMiB: 4096 },
  lg: { size: 'm', vcpus: 4, memoryMiB: 8192 },
  xl: { size: 'l', vcpus: 8, memoryMiB: 16384 },
});

// Orble stops a command after at most 600 s. Exec answers within about 50 s; a command still running then comes back
// as a job, which exec() polls until it ends.
const EXEC_MAX_TIMEOUT_S = 600;

function resolveConfig(config: OrbleConfig) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const apiKey = config.apiKey || env?.ORBLE_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      `Missing Orble API key. Provide 'apiKey' in config or set ORBLE_API_KEY environment variable. ` +
        `Create one at https://orble.tech/settings?tab=api`,
    );
  }
  const baseUrl = (config.baseUrl || env?.ORBLE_API_URL || 'https://orble.tech').replace(/\/+$/, '');
  const user = config.user ?? ((env?.ORBLE_USER || undefined) as OrbleUser | undefined); // empty is unset
  if (user !== undefined && user !== 'agent' && user !== 'root') {
    throw new Error(`Orble user must be 'agent' or 'root', not '${user}'`);
  }
  return { apiKey, baseUrl, ...(user ? { user } : {}) };
}

/** The user one call runs as: the command's own `user` option, else the provider's. */
function userFor(sandbox: OrbleSandbox, options?: RunCommandOptions): OrbleUser {
  const asked = (options as { user?: string } | undefined)?.user;
  return asked === 'root' || asked === 'agent' ? asked : sandbox.user ?? 'root';
}

// Calls the API. A 404 (a box that doesn't exist, or isn't the caller's) comes back as null; other errors throw.
async function request<T>(
  auth: { apiKey: string; baseUrl: string },
  method: string,
  path: string,
  body?: unknown,
  raw?: Uint8Array,
): Promise<T | null> {
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.apiKey}`, 'User-Agent': 'computesdk-orble' };
  let payload: BodyInit | undefined;
  if (raw) {
    payload = raw as BodyInit;
    headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${auth.baseUrl}${path}`, { method, headers, body: payload });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) {
    let message = text.trim() || res.statusText;
    try {
      message = JSON.parse(text).error || message;
    } catch {}
    throw new Error(`Orble API error (${res.status}) on ${method} ${path}: ${message}`);
  }
  return (text ? JSON.parse(text) : null) as T | null;
}

/**
 * One raw file transfer: GET .../files?raw=1 for a whole file, or PUT with the raw body. Node's built-in fetch moves
 * these at about 6 MB/s from a workstation where node:https and curl move 40-48 MB/s (2026-11-23, 64 MiB), so in
 * Node this uses node:https; elsewhere it falls back to fetch. Returns the body, or null on 404.
 */
async function rawTransfer(sandbox: OrbleSandbox, method: 'GET' | 'PUT', path: string, body?: Buffer): Promise<Buffer | null> {
  const user = (sandbox.user ?? 'root') === 'root' ? '&user=root' : '';
  const url = `${sandbox.baseUrl}${boxPath(sandbox.id, `/files?path=${encodeURIComponent(path)}${method === 'GET' ? '&raw=1' : ''}${user}`)}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${sandbox.apiKey}`, 'User-Agent': 'computesdk-orble' };
  if (body) {
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Length'] = String(body.length);
  }
  const fail = (status: number, text: string): never => {
    let message = text.trim() || String(status);
    try {
      message = JSON.parse(text).error || message;
    } catch {}
    throw new Error(`Orble API error (${status}) on ${method} ${path}: ${message}`);
  };
  const https = typeof process !== 'undefined' && process.versions?.node ? await import('node:https').catch(() => null) : null;
  if (https && url.startsWith('https:')) {
    const { status, data } = await new Promise<{ status: number; data: Buffer }>((resolve, reject) => {
      const req = https.request(url, { method, headers }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data: Buffer.concat(parts) }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(body);
    });
    if (status === 404) return null;
    if (status < 200 || status >= 300) fail(status, data.toString('utf8'));
    return data;
  }
  const res = await fetch(url, { method, headers, body: body as BodyInit | undefined });
  if (res.status === 404) return null;
  if (!res.ok) fail(res.status, await res.text());
  return Buffer.from(await res.arrayBuffer());
}

function toSandbox(auth: { apiKey: string; baseUrl: string; user?: OrbleUser }, data: OrbleBoxData): OrbleSandbox {
  return { id: data.name, data, ...auth };
}

const boxPath = (name: string, sub = '') => `/v1/boxes/${encodeURIComponent(name)}${sub}`;

/** Maps ComputeSDK's create options onto the body of POST /v1/boxes. */
function createBody(options: CreateInstanceOptions = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (typeof options.size === 'string') body.size = options.size;
  const from = options.snapshotId ?? options.templateId;
  if (from) body.from = from;
  if (options.name) body.name = options.name;
  return body;
}

function wrapCommand(command: string, options?: RunCommandOptions): string {
  return options?.background ? `nohup sh -c "${escapeShellArg(command)}" >/dev/null 2>&1 &` : command;
}

// A leading dash would be read as an option by find, mkdir and rm.
function shellPath(path: string): string {
  return `"${escapeShellArg(path.startsWith('-') ? `./${path}` : path)}"`;
}

async function exec(sandbox: OrbleSandbox, command: string, options?: RunCommandOptions): Promise<ExecResponse> {
  const body: Record<string, unknown> = { command };
  if (options?.timeout) body.timeout_s = Math.min(EXEC_MAX_TIMEOUT_S, Math.ceil(options.timeout / 1000));
  if (options?.env && Object.keys(options.env).length > 0) body.env = options.env;
  if (options?.cwd) body.cwd = options.cwd;
  if (userFor(sandbox, options) === 'root') body.user = 'root';
  let data = await request<ExecResponse>(sandbox, 'POST', boxPath(sandbox.id, '/exec'), body);
  while (data?.running) data = await request<ExecResponse>(sandbox, 'POST', boxPath(sandbox.id, '/exec'), { job: data.job });
  if (!data) throw new Error(`Orble box ${sandbox.id} not found`);
  return data;
}

// Orble's states are creating, running, suspended, stopped, error, deleting and deleted. A suspended box wakes on the
// next command, but it is not running until then.
export function infoStatus(state: string): InstanceInfo['status'] {
  if (state === 'running') return 'running';
  if (state === 'error') return 'error';
  return 'stopped';
}

function toSnapshot(data: OrbleSnapshotData): Snapshot {
  return {
    id: data.name,
    provider: 'orble',
    createdAt: new Date(data.created_at),
    metadata: {
      state: data.state,
      box: data.box,
      vcpus: data.vcpus,
      memMiB: data.mem_mib,
      diskBytes: data.disk_bytes,
      ...(data.alias && { alias: data.alias }),
      ...(data.gallery && { gallery: true, about: data.about }),
    },
  };
}

async function listSnapshots(config: OrbleConfig): Promise<OrbleSnapshotData[]> {
  return (await request<OrbleSnapshotData[]>(resolveConfig(config), 'GET', '/v1/snapshots')) ?? [];
}

// Deleting a snapshot that doesn't exist (a 404) leaves nothing to do.
async function deleteSnapshot(config: OrbleConfig, name: string): Promise<void> {
  await request(resolveConfig(config), 'DELETE', `/v1/snapshots/${encodeURIComponent(name)}`);
}

async function mustSucceed(run: FsRunCommand, sandbox: OrbleSandbox, command: string, what: string): Promise<CommandResult> {
  const result = await run(sandbox, command);
  if (result.exitCode !== 0) throw new Error(`Failed to ${what}: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
  return result;
}

export const orble = defineProvider<OrbleSandbox, OrbleConfig>({
  name: 'orble',
  sizes: (_config, profile, options) => {
    if (options?.size !== undefined) throw new InstanceSizeError('conflict', 'cannot combine sizeClass with the native Orble size field');
    const shape = ORBLE_SIZES[profile.sizeClass];
    if (!shape) {
      return { status: 'unsupported', reason: `Orble has no ${profile.sizeClass} shape; it offers 1/2, 2/4, 4/8 and 8/16 (vCPU / GiB).` };
    }
    return { status: 'supported', nativeOptions: { size: shape.size }, resolved: { vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: ORBLE_DISK_MIB } };
  },
  methods: {
    instances: {
      create: async (config: OrbleConfig, options?: CreateInstanceOptions) => {
        const auth = resolveConfig(config);
        let data = await request<OrbleBoxData>(auth, 'POST', '/v1/boxes', createBody(options));
        if (!data) throw new Error('Orble API returned no box on create');
        // `keepAwake: true` turns off idle suspension, for a box that serves or runs work on its own. Create can't set it.
        if (options?.keepAwake === true) {
          const name = data.name;
          try {
            const awake = await request<OrbleBoxData>(auth, 'PATCH', boxPath(name), { keep_awake: true });
            if (!awake) throw new Error(`Orble box ${name} not found when keeping it awake`);
            data = awake;
          } catch (error) {
            await request(auth, 'DELETE', boxPath(name)).catch(() => undefined);
            throw error;
          }
        }
        return { instance: toSandbox(auth, data), instanceId: data.name };
      },

      getById: async (config: OrbleConfig, instanceId: string) => {
        const auth = resolveConfig(config);
        const data = await request<OrbleBoxData>(auth, 'GET', boxPath(instanceId));
        return data ? { instance: toSandbox(auth, data), instanceId: data.name } : null;
      },

      list: async (config: OrbleConfig) => {
        const auth = resolveConfig(config);
        const data = await request<OrbleBoxData[]>(auth, 'GET', '/v1/boxes');
        return (data ?? []).map((row) => ({ instance: toSandbox(auth, row), instanceId: row.name }));
      },

      destroy: async (config: OrbleConfig, instanceId: string) => {
        const auth = resolveConfig(config);
        await request(auth, 'DELETE', boxPath(instanceId));
      },

      runCommand: async (sandbox: OrbleSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const data = await exec(sandbox, wrapCommand(command, options), options);
        return { stdout: data.stdout ?? '', stderr: data.stderr ?? '', exitCode: data.exit_code, durationMs: Date.now() - start };
      },

      getInfo: async (sandbox: OrbleSandbox): Promise<InstanceInfo> => {
        const data = await request<OrbleBoxData>(sandbox, 'GET', boxPath(sandbox.id));
        const current = data ?? { ...sandbox.data, state: 'deleted' };
        return {
          id: sandbox.id,
          provider: 'orble',
          status: infoStatus(current.state),
          createdAt: current.created_at ? new Date(current.created_at) : new Date(),
          timeout: 0,
          metadata: { state: current.state, hostname: current.hostname, vcpus: current.vcpus, memMiB: current.mem_mib, diskGiB: current.disk_gib },
        };
      },

      // Shares the port at its own https address: private (Orble sign-in) by default, public with `public: true`.
      getUrl: async (sandbox: OrbleSandbox, options: { port: number; protocol?: string; public?: boolean }): Promise<string> => {
        const data = await request<{ url: string }>(sandbox, 'PUT', boxPath(sandbox.id, `/ports/${options.port}`), {
          access: options.public ? 'public' : 'private',
        });
        if (!data?.url) throw new Error(`Orble box ${sandbox.id} not found`);
        return options.protocol === 'ws' || options.protocol === 'wss' ? data.url.replace(/^https/, 'wss') : data.url;
      },

      // Suspend keeps the box's memory and running programs; resume (or any command) wakes it where it was.
      pause: async (sandbox: OrbleSandbox): Promise<void> => {
        if (!(await request<OrbleBoxData>(sandbox, 'POST', boxPath(sandbox.id, '/suspend')))) throw new Error(`Orble box ${sandbox.id} not found`);
      },
      resume: async (sandbox: OrbleSandbox): Promise<OrbleSandbox> => {
        const data = await request<OrbleBoxData>(sandbox, 'POST', boxPath(sandbox.id, '/resume'));
        if (!data) throw new Error(`Orble box ${sandbox.id} not found`);
        return toSandbox(sandbox, data);
      },
      pauseCapabilities: { memory: true },

      getInstance: (sandbox: OrbleSandbox): OrbleSandbox => sandbox,

      filesystem: {
        // The whole file in one streamed response (raw=1), at any size up to the API's limit.
        readFile: async (sandbox: OrbleSandbox, path: string): Promise<string> => {
          const data = await rawTransfer(sandbox, 'GET', path);
          if (!data) throw new Error(`Failed to read ${path}: not found`);
          return data.toString('utf8');
        },
        // The raw body is streamed to the file, so large files go in one request.
        writeFile: async (sandbox: OrbleSandbox, path: string, content: string): Promise<void> => {
          if (!(await rawTransfer(sandbox, 'PUT', path, Buffer.from(content, 'utf8')))) throw new Error(`Failed to write ${path}: box not found`);
        },
        mkdir: async (sandbox: OrbleSandbox, path: string, run: FsRunCommand): Promise<void> => {
          await mustSucceed(run, sandbox, `mkdir -p ${shellPath(path)}`, `create ${path}`);
        },
        readdir: async (sandbox: OrbleSandbox, path: string, run: FsRunCommand): Promise<FileEntry[]> => {
          const result = await mustSucceed(run, sandbox, `find ${shellPath(path)} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`, `list ${path}`);
          return result.stdout
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [kind, size, modified, ...name] = line.split('\t');
              return { name: name.join('\t'), type: kind === 'd' ? ('directory' as const) : ('file' as const), size: Number(size), modified: new Date(Number(modified) * 1000) };
            });
        },
        exists: async (sandbox: OrbleSandbox, path: string, run: FsRunCommand): Promise<boolean> => {
          const result = await run(sandbox, `test -e ${shellPath(path)}`);
          return result.exitCode === 0;
        },
        remove: async (sandbox: OrbleSandbox, path: string, run: FsRunCommand): Promise<void> => {
          await mustSucceed(run, sandbox, `rm -rf ${shellPath(path)}`, `remove ${path}`);
        },
      },
    },

    snapshot: {
      // A snapshot keeps the box's disk, memory and running programs. A running box pauses briefly while it is taken,
      // then keeps running. A box started from it at the snapshot's size resumes where the snapshot was taken; at a
      // larger size it boots from the snapshot's disk. The API answers once the snapshot is ready.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false, source: 'kept', fork: true },
      create: async (config: OrbleConfig, instanceId: string, options?: CreateSnapshotOptions): Promise<Snapshot> => {
        const auth = resolveConfig(config);
        const data = await request<OrbleSnapshotData>(auth, 'POST', boxPath(instanceId, '/snapshot'), options?.name ? { name: options.name } : {});
        if (!data) throw new Error(`Orble box ${instanceId} not found`);
        return toSnapshot(data);
      },
      // The account's own snapshots; Orble's gallery snapshots are listed as templates.
      list: async (config: OrbleConfig, options?: ListSnapshotsOptions): Promise<Snapshot[]> => {
        const box = options?.instanceId ?? options?.sandboxId;
        const rows = (await listSnapshots(config)).filter((s) => !s.gallery && (!box || s.box === box));
        return rows.slice(0, options?.limit ?? rows.length).map(toSnapshot);
      },
      delete: deleteSnapshot,
    },

    // Orble starts boxes from snapshots, its own (the gallery) or the account's, so templates are snapshots.
    template: {
      create: async (): Promise<Snapshot> => {
        throw new Error('Orble has no template builds; make a template with snapshot.create() from a box you have set up.');
      },
      list: async (config: OrbleConfig, options?: ListTemplatesOptions): Promise<Snapshot[]> => {
        const rows = await listSnapshots(config);
        return rows.slice(0, options?.limit ?? rows.length).map(toSnapshot);
      },
      delete: deleteSnapshot,
    },
  },
});

export default orble;

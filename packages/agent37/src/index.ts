/**
 * Agent37 Provider - Factory-based Implementation
 *
 * Linux sandboxes on the Agent37 API (https://www.agent37.com/docs). The API is a small
 * JSON surface, so this package talks to it with `fetch` and has no SDK dependency.
 *
 * Commands run as root by default, since Agent37 images ship no sudo. Pass
 * `runAsRoot: false` to run as the image's own user instead.
 */

import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { defineProvider, escapeShellArg, InstanceSizeError } from '@computesdk/provider';

import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  FileEntry,
  InstanceInfo,
  ListSnapshotsOptions,
  RunCommandOptions,
} from '@computesdk/provider';

export interface Agent37Config {
  /** Agent37 API key - if not provided, will fallback to AGENT37_API_KEY environment variable */
  apiKey?: string;
  /** API base URL - if not provided, will fallback to AGENT37_BASE_URL, then https://api.agent37.com */
  baseUrl?: string;
  /** Exec base URL - if not provided, will fallback to AGENT37_EXEC_URL, then https://sandbox.agent37.app */
  execUrl?: string;
  /** Run commands as root (default true). Set false to run as the image's default user. */
  runAsRoot?: boolean;
}

/** An instance as the Agent37 API returns it. */
export interface Agent37InstanceData {
  id: string;
  status: string;
  template: string;
  type: string;
  region: string;
  resources: { cpu: number; memory: number; disk: number };
  url: string;
  created: number;
  [key: string]: unknown;
}

export interface Agent37Sandbox {
  id: string;
  data: Agent37InstanceData;
  apiKey: string;
  baseUrl: string;
  execUrl: string;
  runAsRoot: boolean;
}

interface ExecResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
  truncated?: boolean;
}

type FsRunCommand = (sandbox: Agent37Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

// 48 KiB becomes 64 KiB of base64, leaving room for JSON and paths under exec's 128 KB request cap.
const WRITE_CHUNK_BYTES = 48 * 1024;
// Base64 plus the read-status trailer stays below exec's 512 KB output cap.
const READ_CHUNK_BYTES = 256 * 1024;

function resolveConfig(config: Agent37Config) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const apiKey = config.apiKey || env?.AGENT37_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      `Missing Agent37 API key. Provide 'apiKey' in config or set AGENT37_API_KEY environment variable. ` +
        `Create one at https://www.agent37.com/dashboard/cloud/api-keys`,
    );
  }
  const baseUrl = (config.baseUrl || env?.AGENT37_BASE_URL || 'https://api.agent37.com').replace(/\/+$/, '');
  const execUrl = (config.execUrl || env?.AGENT37_EXEC_URL || 'https://sandbox.agent37.app').replace(/\/+$/, '');
  return { apiKey, baseUrl, execUrl, runAsRoot: config.runAsRoot !== false };
}

async function request<T>(
  auth: { apiKey: string; baseUrl: string },
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
  keyHeader = false,
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${auth.baseUrl}${path}`, {
    method,
    headers: {
      ...(keyHeader ? { 'X-Agent37-Key': auth.apiKey } : { Authorization: `Bearer ${auth.apiKey}` }),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (res.status === 404) return { status: 404, data: null };
  const text = await res.text();
  if (!res.ok) throw new Error(`Agent37 API error (${res.status}) on ${method} ${path}: ${text}`);
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

function toSandbox(auth: { apiKey: string; baseUrl: string; execUrl: string; runAsRoot: boolean }, data: Agent37InstanceData): Agent37Sandbox {
  return { id: data.id, data, ...auth };
}

function megabytesToGb(mb: unknown): number | undefined {
  return typeof mb === 'number' && mb > 0 ? Math.ceil(mb / 1024) : undefined;
}

/** Maps ComputeSDK's create options onto the body of POST /v1/instances. */
function createBody(options: CreateInstanceOptions = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.templateId) body.template = options.templateId;
  if (typeof options.type === 'string') body.type = options.type;
  if (typeof options.region === 'string') body.region = options.region;
  if (options.name) body.name = options.name;
  if (options.metadata) body.metadata = options.metadata;
  if (options.envs && Object.keys(options.envs).length > 0) body.env = options.envs;

  const resources = resourcesBody(options);
  if (Object.keys(resources).length > 0) body.resources = resources;
  return body;
}

/** Maps ComputeSDK's size options onto the `resources` block the API expects. */
function resourcesBody(options: CreateInstanceOptions): Record<string, number> {
  const cpu = options.cpu ?? options.vcpus ?? options.cpus;
  const memory = megabytesToGb(options.memory ?? options.memoryMiB ?? options.memoryMb ?? options.memMiB);
  const disk = megabytesToGb(options.diskMb ?? options.diskMiB);
  return {
    ...(typeof cpu === 'number' ? { cpu } : {}),
    ...(memory ? { memory } : {}),
    ...(disk ? { disk } : {}),
  };
}

function wrapCommand(command: string, options?: RunCommandOptions): string {
  let cmd = command;
  if (options?.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
      return `export ${key}="${escapeShellArg(value)}"`;
    });
    cmd = `${exports.join(' && ')} && ${cmd}`;
  }
  if (options?.cwd) cmd = `cd "${escapeShellArg(options.cwd)}" && ${cmd}`;
  if (options?.background) cmd = `nohup sh -c "${escapeShellArg(cmd)}" >/dev/null 2>&1 &`;
  return cmd;
}

// A leading dash would be read as an option by base64, find, mkdir and rm.
function shellPath(path: string): string {
  return `"${escapeShellArg(path.startsWith('-') ? `./${path}` : path)}"`;
}

// Exec is answered by the machine the instance runs on, at execUrl, which takes the key as X-Agent37-Key.
async function exec(sandbox: Agent37Sandbox, command: string, timeoutMs?: number): Promise<ExecResponse> {
  const { data } = await request<ExecResponse>(
    { apiKey: sandbox.apiKey, baseUrl: sandbox.execUrl },
    'POST',
    `/v1/instances/${encodeURIComponent(sandbox.id)}/exec`,
    { command, ...(sandbox.runAsRoot ? { user: 'root' } : {}) },
    timeoutMs,
    true,
  );
  if (!data) throw new Error(`Agent37 instance ${sandbox.id} not found`);
  return data;
}

async function waitForStatus(sandbox: Agent37Sandbox, status: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await request<Agent37InstanceData>(
      sandbox,
      'GET',
      `/v1/instances/${encodeURIComponent(sandbox.id)}`,
    );
    if (data?.status === status) return;
    if (!data || Date.now() > deadline) {
      throw new Error(`Agent37 instance ${sandbox.id} did not reach '${status}' (last status: ${data?.status ?? 'gone'})`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

// Instances created by snapshot.create are forks tagged so list() can find them.
const SNAPSHOT_METADATA_KEY = 'agent37_snapshot_of';

function infoStatus(status: string): InstanceInfo['status'] {
  if (status === 'failed') return 'error';
  if (status === 'stopped' || status === 'stopping' || status === 'deleting' || status === 'deleted') return 'stopped';
  return 'running';
}

async function mustSucceed(run: FsRunCommand, sandbox: Agent37Sandbox, command: string, what: string): Promise<CommandResult> {
  const result = await run(sandbox, command);
  if (result.exitCode !== 0) throw new Error(`Failed to ${what}: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
  return result;
}

// Agent37 offers four create shapes (vCPU / GB RAM): 2/4, 4/8, 4/16 and 4/32. 4 vCPU is the ceiling on
// every type, and a request for more cores is quietly capped, so only exact shapes are claimed.
// https://www.agent37.com/docs/agents-api/instance-sizing
const SHAPES = new Set(['2/4096', '4/8192', '4/16384', '4/32768']);
const NATIVE_SIZE_FIELDS = ['cpu', 'vcpus', 'cpus', 'memory', 'memoryMiB', 'memoryMb', 'memMiB'] as const;

export const agent37 = defineProvider<Agent37Sandbox, Agent37Config>({
  name: 'agent37',
  sizes: (_config, profile, options) => {
    if (NATIVE_SIZE_FIELDS.some((field) => options?.[field] !== undefined)) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with native Agent37 cpu/memory fields');
    }
    const type = options?.type ?? 'default';
    if (type !== 'default' && type !== 'performance' && type !== 'vm') {
      return { status: 'unknown', reason: `Agent37 shapes are published for the default, performance and vm types, not ${JSON.stringify(type)}.` };
    }
    if (!SHAPES.has(`${profile.vcpus}/${profile.memoryMiB}`)) {
      return {
        status: 'unsupported',
        reason: `Agent37 has no ${profile.vcpus} vCPU / ${profile.memoryMiB / 1024} GB shape; it offers 2/4, 4/8, 4/16 and 4/32 (4 vCPU ceiling).`,
      };
    }
    return { status: 'supported', nativeOptions: { cpu: profile.vcpus, memoryMiB: profile.memoryMiB } };
  },
  methods: {
    instances: {
      create: async (config: Agent37Config, options?: CreateInstanceOptions) => {
        const auth = resolveConfig(config);
        // A snapshot is a forked instance (see `snapshot` below): restoring it
        // forks that artifact, so one snapshot can restore many boxes.
        if (options?.snapshotId) {
          const snapshotRef = options.snapshotId;
          // The artifact is kept stopped; fork needs a live source, so wake
          // it, fork, and put it back to sleep.
          const { data: artifactData } = await request<Agent37InstanceData>(
            auth,
            'GET',
            `/v1/instances/${encodeURIComponent(snapshotRef)}`,
          );
          if (!artifactData) throw new Error(`Agent37 snapshot ${snapshotRef} not found`);
          if (artifactData.status === 'stopped') {
            await request(auth, 'POST', `/v1/instances/${encodeURIComponent(snapshotRef)}/start`);
            await waitForStatus(toSandbox(auth, artifactData), 'running');
          }
          const body: Record<string, unknown> = {};
          if (options.name) body.name = options.name;
          if (options.metadata) body.metadata = options.metadata;
          const resources = resourcesBody(options);
          if (Object.keys(resources).length > 0) body.resources = resources;
          const { data } = await request<Agent37InstanceData>(
            auth,
            'POST',
            `/v1/instances/${encodeURIComponent(snapshotRef)}/fork`,
            body,
          );
          if (artifactData.status === 'stopped') {
            await request(auth, 'POST', `/v1/instances/${encodeURIComponent(snapshotRef)}/stop`);
          }
          if (!data) throw new Error(`Agent37 snapshot ${snapshotRef} not found`);
          return { instance: toSandbox(auth, data), instanceId: data.id };
        }
        const { data } = await request<Agent37InstanceData>(auth, 'POST', '/v1/instances', createBody(options));
        if (!data) throw new Error('Agent37 API returned no instance on create');
        return { instance: toSandbox(auth, data), instanceId: data.id };
      },

      getById: async (config: Agent37Config, instanceId: string) => {
        const auth = resolveConfig(config);
        const { data } = await request<Agent37InstanceData>(auth, 'GET', `/v1/instances/${encodeURIComponent(instanceId)}`);
        return data ? { instance: toSandbox(auth, data), instanceId: data.id } : null;
      },

      list: async (config: Agent37Config) => {
        const auth = resolveConfig(config);
        const { data } = await request<{ data: Agent37InstanceData[] }>(auth, 'GET', '/v1/instances');
        // Snapshot artifacts are tagged fork instances; hide them so cleanup
        // that walks the instance list doesn't delete saved snapshots.
        return (data?.data ?? [])
          .filter((row) => (row.metadata as Record<string, string> | undefined)?.[SNAPSHOT_METADATA_KEY] === undefined)
          .map((row) => ({ instance: toSandbox(auth, row), instanceId: row.id }));
      },

      destroy: async (config: Agent37Config, instanceId: string) => {
        const auth = resolveConfig(config);
        await request(auth, 'DELETE', `/v1/instances/${encodeURIComponent(instanceId)}`);
      },

      // Agent37 has no suspend call on the SDK surface, but the API's stop/start
      // pair is a box-identity pause: the same id and the whole disk come back
      // (memory is released — only files survive).
      pause: async (sandbox: Agent37Sandbox) => {
        await request(sandbox, 'POST', `/v1/instances/${encodeURIComponent(sandbox.id)}/stop`);
        await waitForStatus(sandbox, 'stopped');
      },
      resume: async (sandbox: Agent37Sandbox) => {
        await request(sandbox, 'POST', `/v1/instances/${encodeURIComponent(sandbox.id)}/start`);
        await waitForStatus(sandbox, 'running');
      },
      pauseCapabilities: { memory: false },

      runCommand: async (sandbox: Agent37Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const data = await exec(sandbox, wrapCommand(command, options), options?.timeout);
        return { stdout: data.stdout, stderr: data.stderr, exitCode: data.exit_code, durationMs: Date.now() - start };
      },

      getInfo: async (sandbox: Agent37Sandbox): Promise<InstanceInfo> => {
        const { data } = await request<Agent37InstanceData>(sandbox, 'GET', `/v1/instances/${encodeURIComponent(sandbox.id)}`);
        const current = data ?? { ...sandbox.data, status: 'deleted' };
        return {
          id: sandbox.id,
          provider: 'agent37',
          status: infoStatus(current.status),
          createdAt: new Date(current.created * 1000),
          timeout: 0,
          metadata: {
            status: current.status,
            template: current.template,
            type: current.type,
            region: current.region,
            resources: current.resources,
            url: current.url,
          },
        };
      },

      // A signed URL that reaches the port without an API key, valid for one hour.
      getUrl: async (sandbox: Agent37Sandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const { data } = await request<{ url: string }>(
          sandbox,
          'POST',
          `/v1/instances/${encodeURIComponent(sandbox.id)}/signed-url`,
          { port: options.port },
        );
        if (!data?.url) throw new Error(`Agent37 instance ${sandbox.id} not found`);
        // The URL carries its own access token, so it is only ever handed out encrypted.
        return options.protocol === 'ws' || options.protocol === 'wss' ? data.url.replace(/^https/, 'wss') : data.url;
      },

      getInstance: (sandbox: Agent37Sandbox): Agent37Sandbox => sandbox,

      filesystem: {
        readFile: async (sandbox: Agent37Sandbox, path: string): Promise<string> => {
          const target = shellPath(path);
          const read = async (command: string) => {
            const result = await exec(sandbox, command);
            if (result.exit_code !== 0) throw new Error(`Failed to read ${path}: ${result.stderr.trim() || `exit code ${result.exit_code}`}`);
            if (result.truncated) throw new Error(`Failed to read ${path}: truncated exec output`);
            return result;
          };
          const metadataCommand = `test -f ${target} && stat -Lc '%s:%d:%i:%y:%z' -- ${target}`;
          const metadata = (await read(metadataCommand)).stdout;
          const size = Number(metadata.split(':', 1)[0]);
          if (!/^\d+:/.test(metadata) || !Number.isSafeInteger(size)) throw new Error(`Failed to read ${path}: invalid file size`);
          const decoder = new StringDecoder('utf8');
          const parts: string[] = [];
          for (let index = 0; index < Math.max(1, Math.ceil(size / READ_CHUNK_BYTES)); index++) {
            // Carry dd's exit status through base64: sh pipelines otherwise hide producer failures.
            const result = await read(`{ dd if=${target} bs=${READ_CHUNK_BYTES} skip=${index} count=1 iflag=fullblock status=none; printf '\\n%03d' "$?"; } | base64 -w0`);
            if (result.stdout.length > 4 * Math.ceil((READ_CHUNK_BYTES + 4) / 3)) throw new Error(`Failed to read ${path}: oversized read chunk`);
            const bytes = Buffer.from(result.stdout, 'base64');
            if (bytes.toString('base64') !== result.stdout || !/^\n\d{3}$/.test(bytes.subarray(-4).toString('utf8'))) {
              throw new Error(`Failed to read ${path}: invalid read chunk`);
            }
            const status = bytes.subarray(-3).toString('utf8');
            if (status !== '000') throw new Error(`Failed to read ${path}: ${result.stderr.trim() || `exit code ${Number(status)}`}`);
            const expected = Math.min(READ_CHUNK_BYTES, size - index * READ_CHUNK_BYTES);
            if (bytes.length !== expected + 4) throw new Error(`Failed to read ${path}: unexpected read length (expected ${expected}, received ${bytes.length - 4})`);
            parts.push(decoder.write(bytes.subarray(0, -4)));
          }
          if ((await read(metadataCommand)).stdout !== metadata) throw new Error(`Failed to read ${path}: file changed during read`);
          return parts.join('') + decoder.end();
        },
        writeFile: async (sandbox: Agent37Sandbox, path: string, content: string, run: FsRunCommand): Promise<void> => {
          const bytes = Buffer.from(content, 'utf8');
          const target = shellPath(path);
          const directory = shellPath(posix.dirname(path));
          const temporary = `"\${TMPDIR:-/tmp}/.computesdk-write-${randomUUID()}"`;
          try {
            await mustSucceed(run, sandbox, `mkdir -p -- ${directory} && (umask 077; set -C; : > ${temporary})`, `write ${path}`);
            for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
              const encoded = bytes.subarray(offset, offset + WRITE_CHUNK_BYTES).toString('base64');
              await mustSucceed(run, sandbox, `printf '%s' '${encoded}' | base64 -d >> ${temporary}`, `write ${path}`);
            }
            // Custom images may omit flock; only that case falls back to ordinary redirection.
            const copy = `cat ${temporary} > ${target}`;
            await mustSucceed(run, sandbox, `if command -v flock >/dev/null 2>&1; then (flock -x 9 && ${copy}) 9>> ${target}; else ${copy}; fi`, `write ${path}`);
          } finally {
            await run(sandbox, `rm -f -- ${temporary}`).catch(() => {});
          }
        },
        mkdir: async (sandbox: Agent37Sandbox, path: string, run: FsRunCommand): Promise<void> => {
          await mustSucceed(run, sandbox, `mkdir -p ${shellPath(path)}`, `create ${path}`);
        },
        readdir: async (sandbox: Agent37Sandbox, path: string, run: FsRunCommand): Promise<FileEntry[]> => {
          const result = await mustSucceed(
            run,
            sandbox,
            `find ${shellPath(path)} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`,
            `list ${path}`,
          );
          return result.stdout
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [kind, size, modified, ...name] = line.split('\t');
              return {
                name: name.join('\t'),
                type: kind === 'd' ? ('directory' as const) : ('file' as const),
                size: Number(size),
                modified: new Date(Number(modified) * 1000),
              };
            });
        },
        exists: async (sandbox: Agent37Sandbox, path: string, run: FsRunCommand): Promise<boolean> => {
          const result = await run(sandbox, `test -e ${shellPath(path)}`);
          return result.exitCode === 0;
        },
        remove: async (sandbox: Agent37Sandbox, path: string, run: FsRunCommand): Promise<void> => {
          await mustSucceed(run, sandbox, `rm -rf ${shellPath(path)}`, `remove ${path}`);
        },
      },
    },

    // Agent37 has no standalone snapshot object — a fork is the artifact.
    // `snapshot.create` forks the source into an independent instance that
    // keeps its own id and outlives the source; `create({ snapshotId })`
    // forks that artifact into a fresh box; `snapshot.delete` destroys it.
    // Backups exist too (`/{id}/backups` + `/{id}/restore`), but restore is
    // in-place and backups are dropped with the instance, which can't express
    // "snapshot → destroy source → boot a new box".
    snapshot: {
      capabilities: { scope: 'rootfs', memory: false, destroysSource: false, source: 'kept', fork: true },
      create: async (config: Agent37Config, sandboxId: string, options?: CreateSnapshotOptions) => {
        const auth = resolveConfig(config);
        const { data } = await request<Agent37InstanceData>(
          auth,
          'POST',
          `/v1/instances/${encodeURIComponent(sandboxId)}/fork`,
          {
            ...(options?.name ? { name: options.name } : {}),
            metadata: { ...options?.metadata, [SNAPSHOT_METADATA_KEY]: sandboxId },
          },
        );
        if (!data) throw new Error(`Agent37 instance ${sandboxId} not found`);
        // Stop the snapshot artifact so its processes can't mutate files that
        // a later restore would see — a snapshot must stay frozen.
        const snapshot = toSandbox(auth, data);
        await request(auth, 'POST', `/v1/instances/${encodeURIComponent(data.id)}/stop`);
        await waitForStatus(snapshot, 'stopped');
        return {
          id: data.id,
          provider: 'agent37',
          createdAt: new Date((data.created ?? 0) * 1000),
          metadata: { sourceSandboxId: sandboxId },
          native: data,
        };
      },
      list: async (config: Agent37Config, options?: ListSnapshotsOptions) => {
        const auth = resolveConfig(config);
        const { data } = await request<{ data: Agent37InstanceData[] }>(auth, 'GET', '/v1/instances');
        const sourceId = options?.instanceId ?? (options as { sandboxId?: string } | undefined)?.sandboxId;
        return (data?.data ?? [])
          .filter((row) => (row.metadata as Record<string, string> | undefined)?.[SNAPSHOT_METADATA_KEY] !== undefined)
          .filter((row) => !sourceId || (row.metadata as Record<string, string>)[SNAPSHOT_METADATA_KEY] === sourceId)
          .map((row) => ({
            id: row.id,
            provider: 'agent37',
            createdAt: new Date((row.created ?? 0) * 1000),
            native: row,
          }));
      },
      delete: async (config: Agent37Config, snapshotId: string) => {
        const auth = resolveConfig(config);
        // request() maps 404 to a data:null response — an already-gone fork is fine.
        await request(auth, 'DELETE', `/v1/instances/${encodeURIComponent(snapshotId)}`);
      },
    },
  },
});

export default agent37;

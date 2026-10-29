/**
 * Agent37 Provider - Factory-based Implementation
 *
 * Linux sandboxes on the Agent37 API (https://www.agent37.com/docs). The API is a small
 * JSON surface, so this package talks to it with `fetch` and has no SDK dependency.
 *
 * Commands run as root by default, since Agent37 images ship no sudo. Pass
 * `runAsRoot: false` to run as the image's own user instead.
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

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

  const cpu = options.cpu ?? options.vcpus ?? options.cpus;
  const memory = megabytesToGb(options.memory ?? options.memoryMiB ?? options.memoryMb ?? options.memMiB);
  const disk = megabytesToGb(options.diskMb ?? options.diskMiB);
  const resources = {
    ...(typeof cpu === 'number' ? { cpu } : {}),
    ...(memory ? { memory } : {}),
    ...(disk ? { disk } : {}),
  };
  if (Object.keys(resources).length > 0) body.resources = resources;
  return body;
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

export const agent37 = defineProvider<Agent37Sandbox, Agent37Config>({
  name: 'agent37',
  methods: {
    instances: {
      create: async (config: Agent37Config, options?: CreateInstanceOptions) => {
        const auth = resolveConfig(config);
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
        return (data?.data ?? []).map((row) => ({ instance: toSandbox(auth, row), instanceId: row.id }));
      },

      destroy: async (config: Agent37Config, instanceId: string) => {
        const auth = resolveConfig(config);
        await request(auth, 'DELETE', `/v1/instances/${encodeURIComponent(instanceId)}`);
      },

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
          const result = await exec(sandbox, `base64 -w0 ${shellPath(path)}`);
          if (result.exit_code !== 0) throw new Error(`Failed to read ${path}: ${result.stderr.trim() || `exit code ${result.exit_code}`}`);
          if (result.truncated) throw new Error(`Failed to read ${path}: the file is larger than one command's output limit`);
          return Buffer.from(result.stdout, 'base64').toString('utf8');
        },
        writeFile: async (sandbox: Agent37Sandbox, path: string, content: string, run: FsRunCommand): Promise<void> => {
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          const target = shellPath(path);
          await mustSucceed(run, sandbox, `mkdir -p "$(dirname ${target})" && printf '%s' '${encoded}' | base64 -d > ${target}`, `write ${path}`);
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
  },
});

export default agent37;

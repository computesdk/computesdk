/**
 * CoreWeave Sandboxes provider for ComputeSDK, a thin adapter over @coreweave/cwsandbox.
 */

import { CWSandboxNotFoundError, type Sandbox, type SandboxClient, type SandboxRunOptions, type SandboxStatus } from '@coreweave/cwsandbox';
import { createSandboxClient } from '@coreweave/cwsandbox/node';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

const ADAPTER_TAG = 'computesdk';
/** Assigned HTTPS hostnames can show up a little after the sandbox reaches `running`. */
const URL_WAIT_MS = 60_000;
const URL_POLL_MS = 1_000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CoreWeaveConfig {
  /** CoreWeave API access token; falls back to CWSANDBOX_API_KEY. */
  apiKey?: string;
  /** Sandbox API endpoint; falls back to CWSANDBOX_BASE_URL, then https://api.cwsandbox.com. */
  baseUrl?: string;
  /** Default container image. The SDK default is `python:3.11`. */
  image?: string;
  /** Default CPU cores. */
  cpu?: number;
  /** Default memory in MiB. */
  memory?: number;
  /** Default maximum sandbox lifetime in milliseconds. */
  timeout?: number;
}

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

/** Credentials are checked when a call needs them; building the client does no I/O. */
function client(config: CoreWeaveConfig): SandboxClient {
  const apiKey = (config.apiKey || env('CWSANDBOX_API_KEY'))?.trim();
  if (!apiKey) {
    throw new Error(
      'Missing CoreWeave Sandboxes API key: pass coreweave({ apiKey }) or set CWSANDBOX_API_KEY to a CoreWeave API access token. ' +
      'See https://docs.coreweave.com/products/sandboxes'
    );
  }
  const baseUrl = (config.baseUrl || env('CWSANDBOX_BASE_URL'))?.trim();
  return createSandboxClient({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
}

export function createOptions(config: CoreWeaveConfig, options: CreateInstanceOptions = {}): SandboxRunOptions {
  if (options.snapshotId !== undefined) {
    throw new Error('The CoreWeave provider does not restore snapshots; use getInstance() for native snapshot APIs.');
  }
  const cpu = options.cpu ?? config.cpu;
  const memory = options.memory ?? config.memory;
  const timeout = options.timeout ?? config.timeout;
  const image = options.image ?? (options.templateId === undefined ? config.image : undefined);
  const ports: number[] = Array.isArray(options.ports) ? options.ports : [];
  return {
    ...(image !== undefined ? { containerImage: image } : {}),
    ...(cpu !== undefined || memory !== undefined
      ? { resources: { ...(cpu !== undefined ? { cpu: String(cpu) } : {}), ...(memory !== undefined ? { memory: `${memory}Mi` } : {}) } }
      : {}),
    ...(timeout !== undefined ? { maxLifetimeSeconds: Math.ceil(timeout / 1000) } : {}),
    ...(options.envs ? { environmentVariables: options.envs } : {}),
    ...(options.name ? { annotations: { name: options.name } } : {}),
    // A port must be requested at create to get a public HTTPS URL for it.
    ...(ports.length > 0
      ? { services: ports.map((port) => ({ port, visibility: 'public' as const, endpoint: { kind: 'https' as const, auth: 'open' as const } })) }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    tags: [ADAPTER_TAG],
  };
}

/** The argv sent to the sandbox. Env goes through `env` as separate arguments, so values need no quoting. */
export function commandArgv(command: string, options: RunCommandOptions = {}): string[] {
  const vars = Object.entries(options.env ?? {});
  for (const [name] of vars) {
    if (!ENV_NAME.test(name)) throw new Error(`Invalid environment variable name: ${name}`);
  }
  const script = options.background ? `nohup sh -c "${escapeShellArg(command)}" >/dev/null 2>&1 &` : command;
  const shell = ['/bin/sh', '-c', script];
  return vars.length > 0 ? ['/usr/bin/env', ...vars.map(([k, v]) => `${k}=${v}`), ...shell] : shell;
}

function status(value: SandboxStatus | undefined): InstanceInfo['status'] {
  switch (value) {
    case 'pending':
    case 'creating':
    case 'running':
      return 'running';
    case 'failed':
      return 'error';
    default:
      return 'stopped';
  }
}

/** Parses `ls -la` output; works with GNU coreutils and busybox. */
export function parseLs(stdout: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9 || line.startsWith('total ')) continue;
    const name = parts.slice(8).join(' ').replace(/ -> .*$/, '');
    if (name === '.' || name === '..') continue;
    const size = Number.parseInt(parts[4], 10);
    entries.push({ name, type: parts[0].startsWith('d') ? 'directory' : 'file', ...(Number.isFinite(size) ? { size } : {}) });
  }
  return entries;
}

async function shell(sandbox: Sandbox, script: string, what: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await sandbox.commands.run(['/bin/sh', '-c', script]);
  if (result.exitCode !== 0) throw new Error(`${what} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

export const coreweave = defineProvider<Sandbox, CoreWeaveConfig>({
  name: 'coreweave',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const sdk = client(config);
        const request = createOptions(config, options);
        // create() and runFromTemplate() wait for `running` by default.
        const sandbox = options.templateId !== undefined
          ? await sdk.runFromTemplate(options.templateId, request)
          : await sdk.create(request);
        return { instance: sandbox, instanceId: sandbox.sandboxId };
      },

      getById: async (config, instanceId) => {
        try {
          const sandbox = await client(config).fromId(instanceId);
          return { instance: sandbox, instanceId: sandbox.sandboxId };
        } catch (error) {
          if (error instanceof CWSandboxNotFoundError) return null;
          throw error;
        }
      },

      // Lists active (not ended) sandboxes this provider created.
      list: async (config) =>
        (await client(config).listAll({ tags: [ADAPTER_TAG] })).map((sandbox) => ({ instance: sandbox, instanceId: sandbox.sandboxId })),

      destroy: async (config, instanceId) => {
        await client(config).delete(instanceId, { missingOk: true });
      },

      runCommand: async (sandbox, command, options: RunCommandOptions = {}): Promise<CommandResult> => {
        const start = Date.now();
        const result = await sandbox.commands.run(commandArgv(command, options), {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.timeout !== undefined && !options.background ? { timeoutMs: options.timeout } : {}),
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - start };
      },

      getInfo: async (sandbox): Promise<InstanceInfo> => {
        const info = await sandbox.inspect();
        return {
          id: sandbox.sandboxId,
          provider: 'coreweave',
          status: status(info.status),
          createdAt: info.createdAt ?? info.startedAt ?? new Date(),
          timeout: 0,
          metadata: {
            status: info.status,
            ...(info.runnerId ? { runnerId: info.runnerId } : {}),
            ...(info.statusReason ? { statusReason: info.statusReason } : {}),
          },
        };
      },

      getUrl: async (sandbox, { port, protocol }) => {
        const deadline = Date.now() + URL_WAIT_MS;
        for (;;) {
          const info = await sandbox.inspect();
          const match = info.serviceUrls?.find((service) => service.port === port && service.url.startsWith('https://'));
          if (match) {
            const url = new URL(match.url);
            if (protocol) url.protocol = `${protocol}:`;
            return url.toString();
          }
          if (Date.now() >= deadline) {
            throw new Error(`CoreWeave sandbox ${sandbox.sandboxId} has no HTTPS URL for port ${port}. Request the port at create with { ports: [${port}] }.`);
          }
          await new Promise((resolve) => setTimeout(resolve, URL_POLL_MS));
        }
      },

      getInstance: (sandbox) => sandbox,

      filesystem: {
        readFile: (sandbox, path) => sandbox.files.readText(path),
        writeFile: async (sandbox, path, content) => {
          const parent = path.slice(0, path.lastIndexOf('/'));
          if (parent) await shell(sandbox, `mkdir -p "${escapeShellArg(parent)}"`, `mkdir ${parent}`);
          await sandbox.files.write(path, content);
        },
        mkdir: async (sandbox, path) => {
          await shell(sandbox, `mkdir -p "${escapeShellArg(path)}"`, `mkdir ${path}`);
        },
        readdir: async (sandbox, path) => parseLs((await shell(sandbox, `ls -la "${escapeShellArg(path)}"`, `readdir ${path}`)).stdout),
        exists: async (sandbox, path) =>
          (await sandbox.commands.run(['/bin/sh', '-c', `test -e "${escapeShellArg(path)}"`])).exitCode === 0,
        remove: async (sandbox, path) => {
          await shell(sandbox, `rm -rf "${escapeShellArg(path)}"`, `remove ${path}`);
        },
      },
    },
  },
});

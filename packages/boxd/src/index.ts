/**
 * boxd provider for ComputeSDK.
 *
 * Every sandbox is a boxd machine (a KVM microVM), created with `isolated: true`
 * so it is cut off from the rest of the organization's machines. Lifecycle,
 * commands, files and port URLs go through the official `@boxd-sh/sdk`.
 */

import { Boxd, ConflictError, NotFoundError } from '@boxd-sh/sdk';
import type { Machine, MachineCreateParams } from '@boxd-sh/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from 'computesdk';

export interface BoxdConfig {
  /** boxd API key - if not provided, will use the BOXD_API_KEY environment variable */
  apiKey?: string;
  /** Region for new machines (`fra` or `nyc`) - falls back to BOXD_REGION, then the SDK default (Frankfurt) */
  region?: string;
}

export interface BoxdSandbox {
  client: Boxd;
  machine: Machine;
}

function createClient(config: BoxdConfig): Boxd {
  const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env?.BOXD_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      'Missing boxd API key.\n\n' +
      'Create one in the boxd console (https://app.boxd.sh) or with `boxd auth keys create <name>`.\n' +
      'Then pass it: boxd({ apiKey: "bxd_..." })\n' +
      'Or set BOXD_API_KEY in your environment.'
    );
  }
  const region = config.region ?? (typeof process !== 'undefined' ? process.env?.BOXD_REGION : undefined);
  return new Boxd({ apiKey, region });
}

function buildCommand(command: string, options?: RunCommandOptions): string {
  let full = command;
  if (options?.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env).map(([key, value]) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
      return `export ${key}="${escapeShellArg(String(value))}"`;
    });
    full = `${exports.join('; ')}; ${full}`;
  }
  if (options?.background) {
    full = `nohup sh -c "${escapeShellArg(full)}" > /dev/null 2>&1 &`;
  }
  return full;
}

function mapStatus(status: string): InstanceInfo['status'] {
  if (status === 'running' || status === 'pending' || status === 'starting' || status === 'migrating') return 'running';
  if (status === 'failed') return 'error';
  return 'stopped';
}

const _provider = defineProvider<BoxdSandbox, BoxdConfig>({
  name: 'boxd',
  methods: {
    instances: {
      create: async (config: BoxdConfig, options?: CreateInstanceOptions) => {
        const client = createClient(config);
        const fromSnapshot = options?.snapshotId ?? options?.templateId;
        const deleteAfter = options?.timeout ? Math.ceil(options.timeout / 1000) : undefined;

        const params: MachineCreateParams = fromSnapshot
          ? { name: options?.name, fromSnapshot, isolated: true, deleteAfter }
          : { name: options?.name, isolated: true, env: options?.envs, deleteAfter };

        const created = await client.machines.create(params);
        const machine = await client.machines.waitUntilReady(created.id);
        return { instance: { client, machine }, instanceId: machine.id };
      },

      getById: async (config: BoxdConfig, instanceId: string) => {
        const client = createClient(config);
        try {
          const machine = await client.machines.get(instanceId);
          if (machine.status === 'destroyed') return null;
          return { instance: { client, machine }, instanceId: machine.id };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },

      list: async (config: BoxdConfig) => {
        const client = createClient(config);
        const machines = await client.machines.list();
        return machines
          .filter((machine) => machine.status !== 'destroyed')
          .map((machine) => ({ instance: { client, machine }, instanceId: machine.id }));
      },

      destroy: async (config: BoxdConfig, instanceId: string) => {
        const client = createClient(config);
        try {
          await client.machines.delete(instanceId);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      },

      runCommand: async (sandbox: BoxdSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const result = await sandbox.client.machines.exec(sandbox.machine.id, {
            command: buildCommand(command, options),
            cwd: options?.cwd,
            timeout: options?.timeout,
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: BoxdSandbox): Promise<InstanceInfo> => ({
        id: sandbox.machine.id,
        provider: 'boxd',
        status: mapStatus(sandbox.machine.status),
        createdAt: sandbox.machine.createdAt ?? new Date(),
        timeout: sandbox.machine.deleteAt ? Math.max(0, sandbox.machine.deleteAt.getTime() - Date.now()) : 0,
        metadata: {
          name: sandbox.machine.name,
          url: sandbox.machine.access.url,
        },
      }),

      getUrl: async (sandbox: BoxdSandbox, urlOptions: { port: number; protocol?: string }): Promise<string> => {
        const { client, machine } = sandbox;
        const routeName = `p${urlOptions.port}`;
        try {
          await client.machines.proxies.create(machine.id, routeName, urlOptions.port);
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
        }
        const routes = await client.machines.proxies.list(machine.id);
        const route = routes.find((r) => r.name === routeName);
        if (!route) {
          throw new Error(`boxd did not return a proxy route for port ${urlOptions.port} on machine ${machine.id}`);
        }
        const protocol = urlOptions.protocol || 'https';
        return `${protocol}://${route.domain}`;
      },

      filesystem: {
        readFile: async (sandbox: BoxdSandbox, path: string): Promise<string> => {
          const bytes = await sandbox.client.machines.fs.read(sandbox.machine.id, path);
          return new TextDecoder().decode(bytes);
        },

        writeFile: async (sandbox: BoxdSandbox, path: string, content: string): Promise<void> => {
          await sandbox.client.machines.fs.write(sandbox.machine.id, path, content);
        },

        mkdir: async (sandbox: BoxdSandbox, path: string): Promise<void> => {
          await sandbox.client.machines.fs.mkdir(sandbox.machine.id, path);
        },

        readdir: async (sandbox: BoxdSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.client.machines.fs.list(sandbox.machine.id, path);
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isDir ? 'directory' as const : 'file' as const,
            size: entry.size,
            modified: entry.mtime,
          }));
        },

        exists: async (sandbox: BoxdSandbox, path: string): Promise<boolean> =>
          sandbox.client.machines.fs.exists(sandbox.machine.id, path),

        remove: async (sandbox: BoxdSandbox, path: string): Promise<void> => {
          await sandbox.client.machines.fs.remove(sandbox.machine.id, path, { recursive: true });
        },
      },

      getInstance: (sandbox: BoxdSandbox): BoxdSandbox => sandbox,
    },
  },
});

export const boxd = (config: BoxdConfig = {}) => _provider(config);

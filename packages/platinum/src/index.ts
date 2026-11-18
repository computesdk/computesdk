/**
 * Platinum Provider - Factory-based Implementation
 *
 * MicroVM sandboxes on Platinum (https://www.platinum.dev/docs) through the
 * `@platinum-dev/sdk` client. CPU and memory are set per create, so every
 * standard size boots from the same template.
 */

import { NotFoundError, Platinum, Sandbox as PlatinumSandbox } from '@platinum-dev/sdk';
import type { SandboxSpec, SandboxState } from '@platinum-dev/sdk';
import { defineProvider, escapeShellArg, InstanceSizeError } from '@computesdk/provider';

import type { CommandResult, CreateInstanceOptions, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

export interface PlatinumConfig {
  /** Platinum API key - if not provided, will fallback to PLATINUM_API_KEY, then PT_TOKEN environment variables */
  apiKey?: string;
  /** API base URL - if not provided, the SDK reads PLATINUM_API_URL / PT_API_URL, then uses https://api.platinum.dev */
  apiUrl?: string;
  /** Template to boot when a create names neither `templateId` nor `image`. Platinum's own default is `pt-base`. */
  template?: string;
  /** How long create waits for the sandbox to reach `running`, in milliseconds (SDK default 60000) */
  timeout?: number;
}

/** Platinum create fields passed through to `POST /v1/sandboxes` unchanged. */
const NATIVE_FIELDS = [
  'cpu', 'ram_mb', 'disk_gb', 'region', 'pool', 'pool_fallback',
  'auto_stop_minutes', 'auto_archive_days', 'auto_delete_days', 'backup_interval_min',
] as const;

const SIZE_CLASSES = new Set(['sm', 'md', 'lg', 'xl']);

function clientOf(config: PlatinumConfig): Platinum {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const token = config.apiKey || env?.PLATINUM_API_KEY || env?.PT_TOKEN;
  if (!token) {
    throw new Error(
      `Missing Platinum API key. Provide 'apiKey' in config or set PLATINUM_API_KEY environment variable. ` +
        `Create one at https://platinum.dev/dashboard#apikeys`,
    );
  }
  return new Platinum({ token, apiUrl: config.apiUrl });
}

/** Maps ComputeSDK's create options onto Platinum's sandbox spec. */
function specOf(config: PlatinumConfig, options: CreateInstanceOptions = {}): SandboxSpec {
  if (options.snapshotId) {
    throw new Error('Platinum creates sandboxes from a template or image, not a snapshot id. Restore a snapshot with the SDK (sandbox.clone()).');
  }
  if (Array.isArray(options.volumes) && options.volumes.length > 0) {
    throw new Error('@computesdk/platinum does not map create-time volumes. Mount them with the Platinum SDK (`volumes` on sandboxes.create).');
  }
  const spec: Record<string, unknown> = {};
  if (typeof options.image === 'string') spec.image = { base_image: options.image };
  // Sending both lets the API refuse the pair (400) rather than one being dropped silently.
  const template = options.templateId ?? (spec.image ? undefined : config.template);
  if (template) spec.template = template;
  if (options.name) spec.name = options.name;
  if (options.envs && Object.keys(options.envs).length > 0) spec.env = options.envs;
  if (options.metadata) spec.metadata = options.metadata;
  for (const field of NATIVE_FIELDS) {
    if (options[field] !== undefined) spec[field] = options[field];
  }
  return spec as SandboxSpec;
}

/** A sandbox handle pinned to the control plane that owns it, as `sandboxes.connect` builds one. */
function handleOf(client: Platinum, row: SandboxState): PlatinumSandbox {
  return new PlatinumSandbox(client.forOrigin(row.api_url), row.id, {
    state: row.state, name: row.name, hostId: row.hostId, placedPool: row.placedPool ?? null,
  });
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
  // A plain `&` job ends with the exec call; setsid and closed stdio keep it running.
  if (options?.background) cmd = `setsid nohup sh -c "${escapeShellArg(cmd)}" >/dev/null 2>&1 </dev/null &`;
  return cmd;
}

function infoStatus(state: SandboxState['state']): InstanceInfo['status'] {
  if (state === 'failed-provision' || state === 'failed-start' || state === 'lost') return 'error';
  if (state === 'stopping' || state === 'stopped' || state === 'archiving' || state === 'archived' || state === 'deleted') return 'stopped';
  return 'running';
}

export const platinum = defineProvider<PlatinumSandbox, PlatinumConfig>({
  name: 'platinum',
  sizes: (_config, profile, options) => {
    if (options?.ram_mb !== undefined) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with native Platinum ram_mb');
    }
    if (!SIZE_CLASSES.has(profile.sizeClass)) {
      return { status: 'unknown', reason: `No ${profile.sizeClass} mapping is declared for Platinum; pass cpu and ram_mb instead.` };
    }
    return { status: 'supported', nativeOptions: { cpu: profile.vcpus, ram_mb: profile.memoryMiB } };
  },
  methods: {
    instances: {
      create: async (config: PlatinumConfig, options?: CreateInstanceOptions) => {
        const client = clientOf(config);
        const sandbox = await client.sandboxes.create(specOf(config, options), {
          waitForRunning: true,
          waitTimeoutMs: config.timeout,
          signal: options?.signal,
        });
        return { instance: sandbox, instanceId: sandbox.id };
      },

      getById: async (config: PlatinumConfig, sandboxId: string) => {
        const client = clientOf(config);
        try {
          const row = await client.sandboxes.get(sandboxId);
          return row.state === 'deleted' ? null : { instance: handleOf(client, row), instanceId: row.id };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },

      list: async (config: PlatinumConfig) => {
        const client = clientOf(config);
        const results: Array<{ instance: PlatinumSandbox; instanceId: string }> = [];
        for await (const row of client.sandboxes.iterate()) {
          if (row.state !== 'deleted') results.push({ instance: handleOf(client, row), instanceId: row.id });
        }
        return results;
      },

      destroy: async (config: PlatinumConfig, sandboxId: string) => {
        try {
          await clientOf(config).sandboxes.delete(sandboxId);
        } catch (error) {
          // Already gone is what destroy asked for.
          if (!(error instanceof NotFoundError)) throw error;
        }
      },

      runCommand: async (sandbox: PlatinumSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        const result = await sandbox.exec(wrapCommand(command, options), { timeoutMs: options?.timeout });
        return {
          stdout: result.stdout,
          stderr: result.stderr || result.error || '',
          exitCode: result.exit_code,
          durationMs: Date.now() - startTime,
        };
      },

      getInfo: async (sandbox: PlatinumSandbox): Promise<InstanceInfo> => {
        const state = await sandbox.refresh();
        return {
          id: state.id,
          provider: 'platinum',
          status: infoStatus(state.state),
          createdAt: new Date(state.createdAt),
          // Platinum sandboxes have no fixed lifetime; idle stop is `autoStopMinutes`.
          timeout: 0,
          metadata: {
            state: state.state,
            templateId: state.templateId,
            ...(state.templateName && { templateName: state.templateName }),
            region: state.region,
            cpu: state.cpu,
            ramMb: state.ramMb,
            diskGb: state.diskGb,
            ...(state.autoStopMinutes !== undefined && { autoStopMinutes: state.autoStopMinutes }),
          },
        };
      },

      getUrl: async (sandbox: PlatinumSandbox, urlOptions: { port: number; protocol?: string }): Promise<string> => {
        // A private exposure's URL carries its own token, so it opens directly.
        const url = sandbox.exposedUrl(urlOptions.port) ?? (await sandbox.expose(urlOptions.port)).url;
        return urlOptions.protocol ? url.replace(/^https?:\/\//, `${urlOptions.protocol}://`) : url;
      },

      getInstance: (sandbox: PlatinumSandbox): PlatinumSandbox => sandbox,
    },
  },
});

export type { PlatinumSandbox };

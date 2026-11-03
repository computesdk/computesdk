/**
 * Declaw Provider
 *
 * Wraps `@declaw/sdk` to expose the ComputeSDK provider interface.
 */

import { Sandbox as DeclawSandbox, ConnectionConfig, NotFoundError, Volumes as DeclawVolumes } from '@declaw/sdk';
import { defineProvider, escapeShellArg, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle } from '@computesdk/provider';

import type {
  CommandResult,
  InstanceInfo,
  CreateInstanceOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

export interface DeclawConfig {
  /** Declaw API key. Falls back to `DECLAW_API_KEY` env var. */
  apiKey?: string;
  /** API domain, e.g. `api.declaw.ai`. Falls back to `DECLAW_DOMAIN` env var. */
  domain?: string;
  /** Default create-time timeout in milliseconds. */
  timeout?: number;
}

function requireApiKey(config: DeclawConfig): string {
  const apiKey = config.apiKey || process.env.DECLAW_API_KEY;
  if (!apiKey) throw new Error(`Missing Declaw API key. Provide 'apiKey' in config or set DECLAW_API_KEY.`);
  return apiKey;
}

function sandboxIdentity(sandbox: DeclawSandbox, expected?: string): string {
  const id = sandbox?.sandboxId;
  validateSandboxReference(id);
  if (expected !== undefined && id !== expected) {
    throw new Error('Declaw: invalid sandbox identity');
  }
  return id;
}

function validateSandboxReference(id: string): void {
  // Match the public connect() validator. Static kill() omits that check
  // before interpolating the ID into its resource route.
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Declaw: invalid sandbox identity');
  }
}

function isMissingSandbox(error: unknown, sandboxId: string): boolean {
  return error instanceof NotFoundError &&
    (error.sandboxId === undefined || error.sandboxId === sandboxId);
}

export const declaw = defineProvider<DeclawSandbox, DeclawConfig>({
  name: 'declaw',
  methods: {
    instances: {
      create: async (config: DeclawConfig, options?: CreateInstanceOptions) => {
        const apiKey =
          config.apiKey ||
          (typeof process !== 'undefined' && process.env?.DECLAW_API_KEY) ||
          '';
        if (!apiKey) {
          throw new Error(`Missing Declaw API key. Provide 'apiKey' in config or set DECLAW_API_KEY.`);
        }
        if (!apiKey.startsWith('dcl_')) {
          throw new Error(`Invalid Declaw API key format. Keys should start with 'dcl_'.`);
        }

        const domain =
          config.domain ||
          (typeof process !== 'undefined' && process.env?.DECLAW_DOMAIN) ||
          undefined;

        const {
          timeout: requestedTimeoutMs,
          envs,
          name: _name,
          metadata,
          templateId,
          namespace: _namespace,
          directory: _directory,
          volumes,
          ...providerOptions
        } = options || {};

        // `volumes` only counts as unified VolumeMount[] when every entry
        // carries `volume`; a provider-native volumes spec stays in
        // providerOptions and reaches the wire untouched.
        const unifiedVolumes = isUnifiedVolumeMounts(volumes) ? volumes : undefined;
        if (volumes !== undefined && !unifiedVolumes) (providerOptions as any).volumes = volumes;

        const ttMs = requestedTimeoutMs ?? config.timeout ?? 300_000;
        const timeoutSec = Math.max(1, Math.ceil(ttMs / 1000));
        const template = templateId || 'node';

        const sandbox = await DeclawSandbox.create({
          template, timeout: timeoutSec, apiKey, domain, metadata, envs,
          // Unified mounts → declaw's [{volumeId, mountPath}] wire shape.
          ...(unifiedVolumes && {
            volumes: unifiedVolumes.map((m: any) => {
              const ref = resolveVolumeRef(m.volume);
              const volumeId = ref.id ?? ref.name;
              if (!volumeId) throw new Error('declaw volume mount requires a volume id or name');
              return { volumeId, mountPath: m.mountPath };
            }),
          }),
          ...providerOptions,
        });
        const sandboxId = sandboxIdentity(sandbox);
        return { instance: sandbox, instanceId: sandboxId };
      },

      getById: async (config: DeclawConfig, sandboxId: string) => {
        const apiKey = requireApiKey(config);
        validateSandboxReference(sandboxId);
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        let sandbox: DeclawSandbox;
        try {
          // SDK 1.2.3 connect performs one GET /sandboxes/:id; its public
          // NotFoundError is produced by that route's HTTP 404 only.
          sandbox = await DeclawSandbox.connect(sandboxId, { apiKey, domain });
        } catch (error) {
          if (isMissingSandbox(error, sandboxId)) return null;
          throw error;
        }
        sandboxIdentity(sandbox, sandboxId);
        return { instance: sandbox, instanceId: sandboxId };
      },

      list: async (config: DeclawConfig) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const result = await DeclawSandbox.list({ apiKey, domain });
          const infos = Array.isArray(result) ? result : result?.sandboxes ?? [];
          const out: Array<{ instance: DeclawSandbox; instanceId: string }> = [];
          for (const info of infos) {
            const id = (info as any).sandboxId ?? (info as any).sandbox_id;
            if (!id) continue;
            try {
              const sandbox = await DeclawSandbox.connect(id, { apiKey, domain });
              out.push({ instance: sandbox, instanceId: id });
            } catch { /* skip */ }
          }
          return out;
        } catch { return []; }
      },

      destroy: async (config: DeclawConfig, sandboxId: string) => {
        const apiKey = requireApiKey(config);
        validateSandboxReference(sandboxId);
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        let acknowledged: boolean;
        try {
          // Public kill is a single-resource DELETE, not a connect/hydrate call.
          acknowledged = await DeclawSandbox.kill(sandboxId, {
            config: new ConnectionConfig({ apiKey, domain }),
          });
        } catch (error) {
          if (isMissingSandbox(error, sandboxId)) return;
          throw error;
        }
        // The native boolean false is documented as already dead, not failure.
        if (typeof acknowledged !== 'boolean') throw new Error('Declaw: invalid kill acknowledgement');
      },

      runCommand: async (sandbox: DeclawSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(v)}"`).join(' ');
          fullCommand = `${envPrefix} ${fullCommand}`;
        }
        if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

        try {
          const result = await sandbox.commands.run(fullCommand, {
            timeout: options?.timeout !== undefined ? Math.max(1, Math.ceil(options.timeout / 1000)) : undefined,
            requestTimeout: options?.timeout !== undefined ? options.timeout + 30_000 : undefined,
          });
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          const wrapped: any = (error as any)?.result;
          if (wrapped) return { stdout: wrapped.stdout || '', stderr: wrapped.stderr || '', exitCode: wrapped.exitCode ?? 1, durationMs: Date.now() - startTime };
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: DeclawSandbox): Promise<InstanceInfo> => {
        const id = (sandbox as any).sandboxId ?? (sandbox as any).sandbox_id ?? 'declaw-unknown';
        return { id, provider: 'declaw', status: 'running', createdAt: new Date(), timeout: 300_000, metadata: { declawSandboxId: id } };
      },

      getUrl: async (sandbox: DeclawSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const host = (sandbox as any).getHost(options.port);
          const protocol = options.protocol || 'https';
          return `${protocol}://${host}`;
        } catch (error) {
          throw new Error(`Failed to get Declaw host for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: DeclawSandbox, path: string): Promise<string> => (sandbox as any).files.read(path),
        writeFile: async (sandbox: DeclawSandbox, path: string, content: string): Promise<void> => { await (sandbox as any).files.write(path, content); },
        mkdir: async (sandbox: DeclawSandbox, path: string): Promise<void> => { await (sandbox as any).files.makeDir(path); },
        readdir: async (sandbox: DeclawSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await (sandbox as any).files.list(path);
          return entries.map((entry: any) => ({
            name: entry.name,
            type: entry.isDir || entry.isDirectory || entry.type === 'directory' ? 'directory' as const : 'file' as const,
            size: entry.size ?? 0,
            modified: new Date(entry.lastModified ?? entry.modified ?? Date.now()),
          }));
        },
        exists: async (sandbox: DeclawSandbox, path: string): Promise<boolean> => (sandbox as any).files.exists(path),
        remove: async (sandbox: DeclawSandbox, path: string): Promise<void> => { await (sandbox as any).files.remove(path); },
      },
    },

    volume: {
      create: async (config: DeclawConfig, options) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        // File-granular empty volume — supports per-file rw inside the sandbox.
        const info = await DeclawVolumes.empty(options.name, { apiKey, domain });
        return { id: info.volumeId, name: info.name, native: info };
      },
      get: async (config: DeclawConfig, id: string) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const info = await DeclawVolumes.get(id, { apiKey, domain });
          return { id: info.volumeId, name: info.name, native: info };
        } catch { return null; }
      },
      list: async (config: DeclawConfig) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        const infos = await DeclawVolumes.list({ apiKey, domain });
        return (infos ?? []).map((i) => ({ id: i.volumeId, name: i.name, native: i }));
      },
      delete: async (config: DeclawConfig, id: string) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        await withVolumeSettle(() => DeclawVolumes.delete(id, { apiKey, domain }));
      },
    }
  },
});

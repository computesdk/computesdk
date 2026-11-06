import { BoatApi, Configuration, ResponseError } from '@boatdev/sdk';
import type { CreateSandboxRequest, InitOverrideFunction, RequestOpts, Sandbox } from '@boatdev/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { Provider, ProviderSnapshotManager, ProviderTemplateManager, CreateTemplateOptions } from '@computesdk/provider';
import { checked, run } from './commands';
import { readBoatFile, writeBoatFile } from './files';
import { saveSnapshot, listSnapshots, templateInfo } from './snapshots';
import type { BoatSnapshot, BoatTemplate } from './snapshots';
import type { FileEntry } from 'computesdk';

export interface BoatConfig {
  /** Falls back to BOAT_API_KEY. */
  apiKey?: string;
  /** Falls back to BOAT_API_BASE, then https://boat.dev/api/v1. */
  baseURL?: string;
  /** Default sandbox lifetime in milliseconds. Boat defaults to one hour. */
  timeout?: number;
  /** Provisioning deadline in milliseconds (default: 300000). */
  readyTimeout?: number;
  /** Native defaults, including type, environment, noEnv, and from. */
  createOptions?: CreateSandboxRequest;
  /** Named snapshot save deadline in milliseconds (default: 600000). */
  snapshotTimeout?: number;
  /** Default HTTPS preview settings. */
  preview?: BoatPreviewDefaults;
}

/** Boat has an account-level client; retain it alongside the sandbox ID. */
export interface BoatSandbox {
  api: BoatApi;
  id: string;
  /** Boat's sandbox name, so callers can match list() results without a getInfo() call each. */
  name: string;
  preview?: BoatPreviewDefaults;
}

/**
 * The SDK's errors say only "Response returned an error code". Add the status and Boat's
 * error body, and keep an unread `response` for the SDK's retry checks and 404 handling.
 * Overriding request() leaves successful responses, including command streams, untouched.
 */
class BoatClient extends BoatApi {
  protected async request(context: RequestOpts, initOverrides?: RequestInit | InitOverrideFunction): Promise<Response> {
    try {
      return await super.request(context, initOverrides);
    } catch (error) {
      if (!(error instanceof ResponseError)) throw error;
      const { response } = error;
      const text = (await response.clone().text().catch(() => '')).replace(/\s+/g, ' ').trim();
      let detail = text.slice(0, 300);
      try {
        const body = JSON.parse(text) as { error?: unknown; message?: unknown };
        const parts = [body.error, body.message].filter((part): part is string => typeof part === 'string' && part !== '');
        if (parts.length > 0) detail = parts.join(': ').slice(0, 300);
      } catch { /* Not JSON; keep the raw text. */ }
      throw new ResponseError(response, `Boat API error: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
    }
  }
}

function client(config: BoatConfig): BoatApi {
  const apiKey = config.apiKey || process.env.BOAT_API_KEY;
  if (!apiKey) throw new Error("Missing Boat API key. Provide 'apiKey' or set BOAT_API_KEY. Create a key at https://boat.dev/dashboard?tab=api-keys");
  return new BoatClient(new Configuration({
    accessToken: apiKey,
    basePath: config.baseURL || process.env.BOAT_API_BASE || 'https://boat.dev/api/v1',
  }));
}

function seconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('Boat timeout must be a positive number of milliseconds.');
  return Math.ceil(ms / 1000);
}

function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}

/** Unlike the SDK's waitUntilReady, stop on cancelled sandboxes and honour the abort signal. */
async function waitUntilReady(api: BoatApi, sandboxId: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = timeoutMs === 0 ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new Error('Boat creation aborted.');
    const { state } = (await api.get({ sandboxId })).sandbox;
    if (['ready', 'idle', 'running'].includes(state)) return;
    if (['archived', 'archiving', 'error', 'cancelled'].includes(state)) throw new Error(`Boat sandbox ${sandboxId} entered terminal state ${state}.`);
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for Boat sandbox ${sandboxId} to become ready.`);
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
  }
}

function wrap(api: BoatApi, sandbox: Sandbox, preview?: BoatPreviewDefaults) {
  return { instance: { api, id: sandbox.id, name: sandbox.name, ...(preview ? { preview } : {}) }, instanceId: sandbox.id };
}

export interface BoatPreviewDefaults {
  public?: boolean;
  localhost?: boolean;
  title?: string;
}
export interface BoatPreviewOptions extends BoatPreviewDefaults { port: number; protocol?: string }

/** Typed preview controls beyond the portable getUrl interface. */
export async function getBoatUrl(sandbox: BoatSandbox, options: BoatPreviewOptions): Promise<string> {
  if (options.protocol && options.protocol !== 'https') throw new Error('Boat preview URLs support HTTPS only.');
  const settings = { ...sandbox.preview, ...options };
  const hostPortRequest = {
    port: settings.port,
    ...(settings.public === undefined ? {} : { _public: settings.public }),
    ...(settings.localhost === undefined ? {} : { localhost: settings.localhost }),
    ...(settings.title === undefined ? {} : { title: settings.title }),
  };
  const result = await sandbox.api.hostPort({ sandboxId: sandbox.id, hostPortRequest });
  if (!result.url) throw new Error('Boat did not return a preview URL.');
  return result.url;
}

export interface BoatCreateTemplateOptions extends CreateTemplateOptions {
  /** Sandbox whose disk to freeze as a reusable named template. */
  sandboxId: string;
}
export interface BoatProvider extends Provider<BoatSandbox, BoatTemplate, BoatSnapshot> {
  snapshot: ProviderSnapshotManager<BoatSnapshot>;
  template: ProviderTemplateManager<BoatTemplate, BoatCreateTemplateOptions>;
}

const createBoatProvider = defineProvider<BoatSandbox, BoatConfig, BoatTemplate, BoatSnapshot>({
  name: 'boat',
  methods: {
    instances: {
      create: async (config, options) => {
        if (options?.templateId && options?.snapshotId) throw new Error('Specify either templateId or snapshotId, not both.');
        if (options?.metadata !== undefined) throw new Error('Boat does not support arbitrary instance metadata.');
        for (const key of ['cpu', 'cpuLimit', 'cpus', 'vcpus', 'memory', 'memoryMiB', 'memMiB', 'memoryMb', 'diskMiB', 'diskMb', 'diskSize', 'resources', 'launch_parameters', 'deploymentPlan', 'size', 'vmTier', 'gpu', 'image', 'region', 'architecture']) {
          if (options?.[key] !== undefined) throw new Error(`Boat does not support ${key}; select a fixed machine type with type.`);
        }
        const api = client(config);
        const lifetime = options?.timeout ?? (options?.ttlSeconds === undefined ? config.timeout : undefined);
        const defaults = config.createOptions;
        const request: CreateSandboxRequest = {
          ...defaults,
          type: options?.type ?? defaults?.type,
          environment: options?.environment ?? defaults?.environment,
          noEnv: options?.noEnv ?? defaults?.noEnv,
          snapshots: options?.snapshots ?? defaults?.snapshots,
          monitoring: options?.monitoring ?? defaults?.monitoring,
          failFast: options?.failFast ?? defaults?.failFast,
          setupScript: options?.setupScript ?? defaults?.setupScript,
          org: options?.org ?? options?.teamId ?? defaults?.org,
          from: options?.snapshotId ?? options?.templateId ?? options?.from ?? defaults?.from,
          env: options?.envs ?? options?.env ?? defaults?.env,
          ttlSeconds: lifetime === undefined ? (options?.ttlSeconds === undefined ? defaults?.ttlSeconds : options.ttlSeconds) : seconds(lifetime),
        };
        if (options?.signal?.aborted) throw options.signal.reason ?? new Error('Boat creation aborted.');
        const { sandbox } = await api.create({ createSandboxRequest: request });
        try {
          await waitUntilReady(api, sandbox.id, config.readyTimeout ?? 300_000, options?.signal);
          if (options?.signal?.aborted) throw options.signal.reason ?? new Error('Boat creation aborted.');
          if (options?.name) await api.update({ sandboxId: sandbox.id, updateSandboxRequest: { name: options.name } });
          return wrap(api, options?.name ? { ...sandbox, name: options.name } : sandbox, config.preview);
        } catch (error) {
          // A provisioning or rename failure must not leave a billable VM behind.
          try { await api.deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id }); }
          catch (cleanupError) {
            // Boat removes cancelled sandboxes itself, so a 404 means there is nothing left to clean up.
            if (isNotFound(cleanupError)) throw error;
            throw new Error(`Boat creation failed (${String(error)}); cleanup of ${sandbox.id} also failed: ${String(cleanupError)}`);
          }
          throw error;
        }
      },
      getById: async (config, sandboxId) => {
        const api = client(config);
        try { return wrap(api, (await api.get({ sandboxId })).sandbox, config.preview); }
        catch (error) { if (isNotFound(error)) return null; throw error; }
      },
      list: async config => {
        const api = client(config);
        const items: ReturnType<typeof wrap>[] = [];
        let cursor: string | undefined;
        do {
          const page = await api.sandboxes({ cursor });
          items.push(...page.sandboxes.filter(s => ['ready', 'idle', 'running'].includes(s.state)).map(s => wrap(api, s, config.preview)));
          cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
        } while (cursor);
        return items;
      },
      destroy: async (config, sandboxId) => {
        try { await client(config).deleteSandbox({ sandboxId, xAsciiConfirmDelete: sandboxId }); }
        catch (error) { if (!isNotFound(error)) throw error; }
      },
      runCommand: run,
      streamCommand: run,
      getInfo: async sandbox => {
        const info = (await sandbox.api.get({ sandboxId: sandbox.id })).sandbox;
        return {
          id: info.id, provider: 'boat',
          status: ['error', 'cancelled'].includes(info.state) ? 'error' : ['archived', 'archiving'].includes(info.state) ? 'stopped' : 'running',
          createdAt: info.createdAt ?? new Date(0),
          timeout: info.ttlSeconds == null ? 0 : info.ttlSeconds * 1000,
          metadata: { name: info.name, state: info.state, type: info.type, ip: info.ip, environment: info.environment, archiveAfter: info.archiveAfter },
        };
      },
      getUrl: getBoatUrl,
      filesystem: {
        readFile: async (sandbox, path) => Buffer.from(await readBoatFile(sandbox, path)).toString('utf8'),
        writeFile: writeBoatFile,
        mkdir: async (sandbox, path) => { await checked(sandbox, `mkdir -p -- "${escapeShellArg(path)}"`); },
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const script = 'import os,json,sys; p=sys.argv[1]; print(json.dumps([dict(name=e.name,type="directory" if e.is_dir() else "file",size=e.stat(follow_symlinks=False).st_size,modified=e.stat(follow_symlinks=False).st_mtime) for e in os.scandir(p)]))';
          const entries: Array<Omit<FileEntry, 'modified'> & { modified: number }> = JSON.parse(await checked(sandbox, `python3 -c "${escapeShellArg(script)}" "${escapeShellArg(path)}"`));
          return entries.map(entry => ({ ...entry, modified: new Date(entry.modified * 1000) }));
        },
        exists: async (sandbox, path) => {
          const result = await run(sandbox, `test -e "${escapeShellArg(path)}"`);
          if (result.exitCode > 1) throw new Error(`Boat filesystem exists failed: ${result.stderr}`);
          return result.exitCode === 0;
        },
        remove: async (sandbox, path) => { await checked(sandbox, `rm -rf -- "${escapeShellArg(path)}"`); },
      },
      getInstance: sandbox => sandbox,
    },
    snapshot: {
      create: (config, sandboxId, options) => saveSnapshot(client(config), config, sandboxId, options),
      list: (config, options) => listSnapshots(client(config), options),
      delete: async (config, name) => {
        try { await client(config).deleteNamedSnapshot({ name }); }
        catch (error) { if (!isNotFound(error)) throw error; }
      },
    },
    template: {
      create: async (config, baseOptions) => {
        const options = baseOptions as BoatCreateTemplateOptions;
        if (!options.sandboxId) throw new Error('Boat template creation requires sandboxId.');
        if (options.description !== undefined) throw new Error('Boat named templates do not support descriptions.');
        return templateInfo(await saveSnapshot(client(config), config, options.sandboxId, options));
      },
      list: async (config, options) => (await listSnapshots(client(config), options)).map(templateInfo),
      delete: async (config, name) => {
        try { await client(config).deleteNamedSnapshot({ name }); }
        catch (error) { if (!isNotFound(error)) throw error; }
      },
    },
  },
});

export function boat(config: BoatConfig = {}): BoatProvider {
  const provider = createBoatProvider(config);
  return { ...provider, snapshot: provider.snapshot!, template: provider.template! };
}

export { readBoatFile, writeBoatFile } from './files';
export type { BoatSnapshot, BoatTemplate } from './snapshots';
export type { CreateSandboxRequest as BoatCreateOptions } from '@boatdev/sdk';

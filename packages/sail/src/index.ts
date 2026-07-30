/**
 * Sail provider for ComputeSDK.
 *
 * The provider maps ComputeSDK's universal sandbox interface onto Sailboxes
 * through the official `@sailresearch/sdk` package.
 */

import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';
import {
  App,
  Client,
  Image,
  NotFoundError,
  Sailbox,
  resolveConfig,
  type ExecOptions,
  type ImageSpec,
  type SailboxSize,
} from '@sailresearch/sdk';

/** Configuration for the Sail provider. */
export interface SailConfig {
  /** Sail API key. Falls back to `SAIL_API_KEY`. */
  apiKey?: string;
  /** App that owns created Sailboxes. Falls back to `SAIL_APP`, then `computesdk`. */
  app?: string;
  /** Image used by created Sailboxes. Defaults to Sail's ARM64 Devbox builtin. */
  image?: ImageSpec | Image;
}

const PROVIDER = 'sail';
const DEFAULT_APP = 'computesdk';
const DEFAULT_SIZE: SailboxSize = 's';
const GONE_STATUSES = new Set(['terminating', 'terminated']);
const MAX_RESOLVED_CONFIGS = 32;

interface ResolvedSailConfig {
  client: Client;
  appName: string;
  appPromise?: Promise<App>;
}

const resolvedConfigs = new Map<string, ResolvedSailConfig>();

/** Resolve and cache equivalent provider configs so their transports are shared. */
function resolve(config: SailConfig): ResolvedSailConfig {
  const environment = resolveConfig();
  const apiKey = config.apiKey ?? environment.apiKey;
  if (!apiKey) {
    throw new Error(
      'Missing Sail API key. Pass sail({ apiKey }) or set SAIL_API_KEY. ' +
        'Create a key at https://app.sailresearch.com.',
    );
  }
  const appName = config.app ?? process.env.SAIL_APP ?? DEFAULT_APP;
  const cacheKey = JSON.stringify([
    apiKey,
    appName,
    environment.mode ?? null,
    environment.apiUrl,
    environment.sailboxApiUrl,
    environment.imagebuilderUrl,
    environment.ingressScheme,
    environment.ingressBase,
  ]);
  let entry = resolvedConfigs.get(cacheKey);
  if (entry) {
    // Refresh insertion order so the bounded map behaves as an LRU cache.
    resolvedConfigs.delete(cacheKey);
    resolvedConfigs.set(cacheKey, entry);
    return entry;
  }

  entry = {
    client: config.apiKey
      ? clientWithKey(config.apiKey, environment)
      : Client.fromEnv(),
    appName,
  };
  resolvedConfigs.set(cacheKey, entry);
  if (resolvedConfigs.size > MAX_RESOLVED_CONFIGS) {
    const oldest = resolvedConfigs.keys().next().value;
    if (oldest !== undefined) resolvedConfigs.delete(oldest);
  }
  return entry;
}

/** Resolve an app once per provider config and share concurrent lookups. */
function resolveApp(config: SailConfig): Promise<App> {
  const entry = resolve(config);
  if (entry.appPromise) return entry.appPromise;

  const pending = App.find(entry.appName, {
    client: entry.client,
    mintIfMissing: true,
  });
  entry.appPromise = pending;
  pending.catch(() => {
    if (entry.appPromise === pending) entry.appPromise = undefined;
  });
  return pending;
}

/** Preserve connection settings resolved by the Sail SDK. */
function clientWithKey(apiKey: string, environment: ReturnType<typeof resolveConfig>): Client {
  return Client.fromConfig({
    apiKey,
    mode: environment.mode ?? undefined,
    apiUrl: environment.apiUrl,
    sailboxApiUrl: environment.sailboxApiUrl,
    imagebuilderUrl: environment.imagebuilderUrl,
    // `ingressUrl` is a path-mode override. Subdomain mode is carried by mode.
    ingressUrl:
      environment.ingressScheme === 'path'
        ? environment.ingressBase
        : undefined,
  });
}

/** Convert an aborted signal into a stable Error for runtimes with arbitrary reasons. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Sailbox creation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Race creation against ComputeSDK cancellation and terminate a late result.
 * Sail's create API is idempotent but not abortable, so cleanup must remain
 * attached after the caller stops waiting to prevent an orphaned Sailbox.
 */
function createWithAbortCleanup(
  create: Promise<Sailbox>,
  signal: AbortSignal | undefined,
  client: Client,
): Promise<Sailbox> {
  if (!signal) return create;
  if (signal.aborted) {
    void create.then((box) => client.terminateSailbox(box.sailboxId)).catch(() => undefined);
    return Promise.reject(abortError(signal));
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      void create.then((box) => client.terminateSailbox(box.sailboxId)).catch(() => undefined);
      rejectPromise(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    create.then(
      (box) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolvePromise(box);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        rejectPromise(error);
      },
    );
  });
}

/** Reject options that Sail cannot honor without changing their meaning. */
function validateCreateOptions(options: CreateSandboxOptions | undefined): void {
  const supported = new Set([
    'memoryGib',
    'name',
    'provider',
    'signal',
    'size',
    'timeout',
  ]);
  const unsupported = Object.keys(options ?? {}).filter(
    (key) => options?.[key] !== undefined && !supported.has(key),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Sail does not support create option(s): ${unsupported.join(', ')}. ` +
        'Configure the image on sail({ image }) and set environment variables per command.',
    );
  }
  if (options?.timeout !== undefined) {
    throw new Error(
      'Sail does not support ComputeSDK create timeout because it is a hard ' +
        'sandbox lifetime. Bound individual commands with runCommand timeout ' +
        'or call destroy() when finished.',
    );
  }
  if (
    options?.size !== undefined &&
    options.size !== 's' &&
    options.size !== 'm' &&
    options.size !== 'l'
  ) {
    throw new Error(
      `Sail does not support size ${options.size}; use s, m, or l.`,
    );
  }
}

/** Return a size after validateCreateOptions has narrowed it to Sail's tiers. */
function sailboxSize(size: string | undefined): SailboxSize | undefined {
  return size as SailboxSize | undefined;
}

/** Map ComputeSDK protocols onto Sail ingress listeners. */
function toIngressProtocol(protocol: string | undefined): 'http' | 'tcp' {
  if (protocol === undefined || protocol === 'http' || protocol === 'https') {
    return 'http';
  }
  if (protocol === 'tcp') return 'tcp';
  throw new Error(`Sail does not support ingress protocol ${protocol}; use http, https, or tcp.`);
}

/** Map Sail lifecycle states onto ComputeSDK's three status values. */
function toStatus(status: string): SandboxInfo['status'] {
  switch (status) {
    case 'running':
      return 'running';
    case 'failed':
    case 'create_failed':
    case 'interrupted_unsafe_to_retry':
      return 'error';
    default:
      return 'stopped';
  }
}

/** Translate millisecond ComputeSDK command timeouts into Sail seconds. */
function toExecOptions(options?: RunCommandOptions): ExecOptions {
  return {
    cwd: options?.cwd,
    env: options?.env,
    background: options?.background,
    timeoutSeconds:
      options?.timeout !== undefined ? options.timeout / 1_000 : undefined,
  };
}

export const sail = defineProvider<Sailbox, SailConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config, options?: CreateSandboxOptions) => {
        validateCreateOptions(options);
        if (options?.signal?.aborted) throw abortError(options.signal);
        const { client } = resolve(config);
        const app = await resolveApp(config);
        if (options?.signal?.aborted) throw abortError(options.signal);

        const creation = Sailbox.create({
          app,
          name: options?.name ?? `csdk-${crypto.randomUUID().slice(0, 8)}`,
          client,
          image: config.image ?? Image.devbox('arm64'),
          size: sailboxSize(options?.size) ?? DEFAULT_SIZE,
          memoryGib: options?.memoryGib,
        });
        const sandbox = await createWithAbortCleanup(creation, options?.signal, client);
        return { sandbox, sandboxId: sandbox.sailboxId };
      },

      getById: async (config, sandboxId) => {
        const { client } = resolve(config);
        try {
          const sandbox = await Sailbox.get(sandboxId, { client });
          if (GONE_STATUSES.has(sandbox.status)) return null;
          return { sandbox, sandboxId: sandbox.sailboxId };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },

      list: async (config) => {
        const { client, appName } = resolve(config);
        let app: App;
        try {
          app = await App.find(appName, { client, mintIfMissing: false });
        } catch (error) {
          if (error instanceof NotFoundError) return [];
          throw error;
        }
        const sandboxes = await Sailbox.list({ appId: app.id, client });
        return sandboxes
          .filter((sandbox) => !GONE_STATUSES.has(sandbox.status))
          .map((sandbox) => ({ sandbox, sandboxId: sandbox.sailboxId }));
      },

      destroy: async (config, sandboxId) => {
        await resolve(config).client.terminateSailbox(sandboxId);
      },

      runCommand: async (
        sandbox,
        command,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startedAt = Date.now();
        if (options?.background) {
          await sandbox.exec(command, toExecOptions(options));
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            durationMs: Date.now() - startedAt,
          };
        }
        const result = await sandbox.run(command, toExecOptions(options));
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
        };
      },

      getInfo: async (sandbox): Promise<SandboxInfo> => {
        const current = await Sailbox.get(sandbox.sailboxId, {
          client: sandbox.client,
        });
        return {
          id: current.sailboxId,
          provider: PROVIDER,
          status: toStatus(current.status),
          createdAt: current.createdAt ?? new Date(0),
          timeout: 0,
        };
      },

      getUrl: async (sandbox, options): Promise<string> => {
        const protocol = toIngressProtocol(options.protocol);
        const existing = await sandbox.listener(options.port).catch((error: unknown) => {
          if (!(error instanceof NotFoundError)) throw error;
          return undefined;
        });
        if (existing === undefined) {
          await sandbox.expose(options.port, { protocol });
        } else if (existing.protocol !== protocol) {
          throw new Error(
            `Sailbox port ${options.port} is already exposed as ${existing.protocol}; ` +
              `request ${existing.protocol} or unexpose it first.`,
          );
        }

        const listener = await sandbox.waitForListener(options.port);
        if (listener.endpoint?.kind === 'http') return listener.endpoint.url;
        if (listener.endpoint?.kind === 'tcp') {
          return `tcp://${listener.endpoint.host}:${listener.endpoint.port}`;
        }
        throw new Error(`Sailbox port ${options.port} has no reachable endpoint.`);
      },

      filesystem: {
        readFile: async (sandbox, path) =>
          (await sandbox.fs.read(path)).toString('utf8'),
        writeFile: async (sandbox, path, content) => {
          await sandbox.fs.write(path, content);
        },
        mkdir: async (sandbox, path) => {
          await sandbox.fs.mkdir(path);
        },
        readdir: async (sandbox, path): Promise<FileEntry[]> =>
          (await sandbox.fs.ls(path)).map((entry) => ({
            name: entry.name,
            type: entry.type === 'directory' ? 'directory' : 'file',
            size: entry.size,
            modified: new Date(entry.modifiedTime * 1_000),
          })),
        exists: async (sandbox, path) => sandbox.fs.exists(path),
        remove: async (sandbox, path) => {
          await sandbox.fs.remove(path);
        },
      },

      getInstance: (sandbox) => sandbox,
    },
  },
});

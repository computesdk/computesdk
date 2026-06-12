/**
 * Lelantos Provider - Factory-based Implementation
 *
 * Forked from @computesdk/e2b. Lelantos is an E2B-API-compatible Firecracker
 * microVM sandbox platform (EU-native, Hetzner bare-metal), so it wraps the same
 * `e2b` npm SDK — but pointed at a lelantos control plane via `domain` / `apiUrl`,
 * and without the `e2b_` key prefix check (lelantos issues `lel_…` keys, and the
 * underlying e2b SDK does NOT validate the key format).
 *
 * Two things make this distinct from stock @computesdk/e2b:
 *   1. Dual-key resolution: LELANTOS_API_KEY → E2B_API_KEY, accepts lel_/e2b_.
 *   2. `domain` / `apiUrl` are threaded into EVERY e2b SDK call (create/connect/
 *      list/kill/snapshot/template) — stock @computesdk/e2b only forwards them to
 *      `create`, leaving lifecycle calls pointed at api.e2b.app.
 */

import { Sandbox as E2BSandbox, CommandExitError } from 'e2b';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

type E2BExecutionResult = { stdout?: string; stderr?: string; exitCode?: number };

/**
 * A genuine non-zero command exit carries a structured result. The e2b SDK
 * throws `CommandExitError` (which IS the CommandResult — exitCode/stdout/stderr
 * getters), but older paths / mocks may instead attach an `.result` object. This
 * matches BOTH shapes without depending on the concrete class identity (robust
 * across e2b minor versions and against the vitest mock).
 */
function asCommandExit(error: unknown): { stdout: string; stderr: string; exitCode: number } | null {
  if (error instanceof CommandExitError) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: typeof error.exitCode === 'number' ? error.exitCode : 1,
    };
  }
  // Duck-typed fallback: an error that itself exposes a numeric exitCode and the
  // CommandResult fields (covers any e2b build that names the class differently
  // or the structured-result test mock).
  const e = error as { exitCode?: unknown; stdout?: unknown; stderr?: unknown; result?: E2BExecutionResult };
  if (e && typeof e.exitCode === 'number' && (typeof e.stdout === 'string' || typeof e.stderr === 'string')) {
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : '',
      exitCode: e.exitCode,
    };
  }
  // Legacy shape: error.result = { stdout, stderr, exitCode }.
  const result = e?.result;
  if (result && typeof result.exitCode === 'number') {
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode,
    };
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type E2BFileEntry = {
  name: string;
  isDir?: boolean;
  isDirectory?: boolean;
  size?: number;
  lastModified?: string | number | Date;
};
type E2BSnapshotResult = string | { snapshotId?: string; id?: string; templateId?: string };
type SnapshotCapableE2BSandbox = E2BSandbox & {
  createSnapshot: (options?: { name?: string }) => Promise<E2BSnapshotResult>;
};
type E2BSandboxStatics = typeof E2BSandbox & {
  listTemplates?: (options: { apiKey?: string; domain?: string; apiUrl?: string }) => Promise<unknown[]>;
  deleteTemplate?: (snapshotId: string, options: { apiKey?: string; domain?: string; apiUrl?: string }) => Promise<unknown>;
};

export interface LelantosConfig {
  /**
   * Lelantos API key. Accepts the `lel_…` form OR the `e2b_…` form of a
   * lelantos key. If not provided, falls back to the `LELANTOS_API_KEY`
   * environment variable, then `E2B_API_KEY`.
   */
  apiKey?: string;
  /**
   * Lelantos control-plane + sandbox domain, e.g. `'lelantos.ai'`. The e2b SDK
   * derives the control-plane URL as `https://api.${domain}` and the sandbox
   * preview host as `{port}-{sandboxId}.${domain}`. If not provided, falls back
   * to the `LELANTOS_DOMAIN` then `E2B_DOMAIN` environment variable.
   */
  domain?: string;
  /**
   * Explicit control-plane URL override (e.g. a non-`api.` host or a port).
   * Takes precedence over `domain`-derived URLs for control-plane calls. Falls
   * back to `LELANTOS_API_URL` then `E2B_API_URL`.
   */
  apiUrl?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

const env = (key: string): string | undefined =>
  (typeof process !== 'undefined' ? process.env?.[key] : undefined) || undefined;

/** Resolve the API key, falling back LELANTOS_API_KEY → E2B_API_KEY. */
function resolveApiKey(config: LelantosConfig): string {
  return config.apiKey || env('LELANTOS_API_KEY') || env('E2B_API_KEY') || '';
}

/** Resolve the domain, falling back LELANTOS_DOMAIN → E2B_DOMAIN. */
function resolveDomain(config: LelantosConfig): string | undefined {
  return config.domain || env('LELANTOS_DOMAIN') || env('E2B_DOMAIN');
}

/** Resolve the explicit control-plane URL, falling back LELANTOS_API_URL → E2B_API_URL. */
function resolveApiUrl(config: LelantosConfig): string | undefined {
  return config.apiUrl || env('LELANTOS_API_URL') || env('E2B_API_URL');
}

/**
 * The connection options threaded into EVERY e2b SDK call (create/connect/list/
 * kill/snapshot/template). This is the must-fix vs. stock @computesdk/e2b, which
 * only forwards `domain` to `create` — leaving lifecycle calls pointed at
 * api.e2b.app. Undefined values are omitted so the SDK's own env-var fallbacks
 * still apply.
 */
function connectOpts(config: LelantosConfig): Record<string, any> {
  const opts: Record<string, any> = { apiKey: resolveApiKey(config) };
  const domain = resolveDomain(config);
  const apiUrl = resolveApiUrl(config);
  if (domain) opts.domain = domain;
  if (apiUrl) opts.apiUrl = apiUrl;
  return opts;
}

export const lelantos = defineProvider<E2BSandbox, LelantosConfig>({
  name: 'lelantos',
  methods: {
    sandbox: {
      create: async (config: LelantosConfig, options?: CreateSandboxOptions) => {
        const apiKey = resolveApiKey(config);

        if (!apiKey) {
          throw new Error(`Missing Lelantos API key. Provide 'apiKey' in config or set LELANTOS_API_KEY (or E2B_API_KEY) environment variable.`);
        }

        // NOTE: stock @computesdk/e2b throws here unless the key starts with
        // 'e2b_'. Lelantos issues 'lel_…' keys (and accepts the 'e2b_…' form of
        // a lelantos key), and the underlying e2b SDK does NOT validate the key
        // format — so the prefix check is intentionally dropped.

        const timeout = options?.timeout ?? config.timeout ?? 300000;

        try {
          let sandbox: E2BSandbox;
          let sandboxId: string;

          const {
            timeout: _timeout, envs, name: _name, metadata, templateId, snapshotId,
            sandboxId: _sandboxId, namespace: _namespace, directory: _directory, ...providerOptions
          } = options || {};

          // Thread apiKey + domain + apiUrl into the create call alongside any
          // per-call provider options.
          const createOpts: Record<string, any> = {
            ...connectOpts(config),
            timeoutMs: timeout,
            envs,
            metadata,
            ...providerOptions,
          };

          const templateOrSnapshot = templateId || snapshotId;
          if (templateOrSnapshot) {
            sandbox = await E2BSandbox.create(templateOrSnapshot, createOpts);
          } else {
            sandbox = await E2BSandbox.create(createOpts);
          }
          if (!sandbox.sandboxId) throw new Error('Lelantos create() returned sandbox without an ID');
          sandboxId = sandbox.sandboxId;

          return { sandbox, sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(`Lelantos authentication failed. Please check your LELANTOS_API_KEY (or E2B_API_KEY) environment variable.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`Lelantos quota exceeded. Please check your usage at https://lelantos.ai/`);
            }
          }
          throw new Error(`Failed to create Lelantos sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: LelantosConfig, sandboxId: string) => {
        try {
          const sandbox = await E2BSandbox.connect(sandboxId, connectOpts(config));
          return { sandbox, sandboxId };
        } catch { return null; }
      },

      list: async (config: LelantosConfig) => {
        try {
          const paginator = E2BSandbox.list(connectOpts(config));
          const items = await paginator.nextItems();
          return items.map((sandbox) => {
            const listedSandbox = sandbox as unknown as E2BSandbox & { id?: string; sandboxId?: string };
            const sandboxId = listedSandbox.id || listedSandbox.sandboxId || 'lelantos-unknown';
            return { sandbox: listedSandbox, sandboxId };
          });
        } catch { return []; }
      },

      destroy: async (config: LelantosConfig, sandboxId: string) => {
        try {
          const sandbox = await E2BSandbox.connect(sandboxId, connectOpts(config));
          await sandbox.kill();
        } catch { /* already destroyed */ }
      },

      runCommand: async (sandbox: E2BSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`).join(' ');
          fullCommand = `${envPrefix} ${fullCommand}`;
        }
        if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

        // Bounded retry ONLY for transient infrastructure errors (e.g. envd
        // cold-start on a freshly created sandbox, where the first exec races the
        // in-guest daemon coming up). A genuine non-zero command exit is a valid
        // result and is returned immediately — never retried, never masked as 127.
        const MAX_ATTEMPTS = 3;
        const BACKOFF_MS = 1000;
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const execution = await sandbox.commands.run(fullCommand);
            return { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, durationMs: Date.now() - startTime };
          } catch (error) {
            // (1) Real command exit (ran, exited non-zero): surface the REAL
            // exitCode + stderr immediately. NOT an infra error, do not retry.
            const exit = asCommandExit(error);
            if (exit) {
              return { stdout: exit.stdout, stderr: exit.stderr, exitCode: exit.exitCode, durationMs: Date.now() - startTime };
            }

            // (2) Infrastructure / connection / not-ready error. Retry with
            // bounded backoff before giving up.
            lastError = error;
            if (attempt < MAX_ATTEMPTS) {
              await sleep(BACKOFF_MS);
              continue;
            }
          }
        }

        // (3) Still failing after retries: SURFACE the real error message in
        // stderr with a non-zero exit code, instead of a silent fake 127.
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        return { stdout: '', stderr: message, exitCode: 1, durationMs: Date.now() - startTime };
      },

      getInfo: async (sandbox: E2BSandbox): Promise<SandboxInfo> => ({
        id: sandbox.sandboxId || 'lelantos-unknown',
        provider: 'lelantos',
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: { lelantosSandboxId: sandbox.sandboxId }
      }),

      getUrl: async (sandbox: E2BSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const host = sandbox.getHost(options.port);
          const protocol = options.protocol || 'https';
          return `${protocol}://${host}`;
        } catch (error) {
          throw new Error(`Failed to get Lelantos host for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: E2BSandbox, path: string): Promise<string> => sandbox.files.read(path),
        writeFile: async (sandbox: E2BSandbox, path: string, content: string): Promise<void> => { await sandbox.files.write(path, content); },
        mkdir: async (sandbox: E2BSandbox, path: string): Promise<void> => { await sandbox.files.makeDir(path); },
        readdir: async (sandbox: E2BSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(path);
          return entries.map((entry: E2BFileEntry) => ({
            name: entry.name,
            type: (entry.isDir || entry.isDirectory) ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: new Date(entry.lastModified || Date.now())
          }));
        },
        exists: async (sandbox: E2BSandbox, path: string): Promise<boolean> => sandbox.files.exists(path),
        remove: async (sandbox: E2BSandbox, path: string): Promise<void> => { await sandbox.files.remove(path); }
      },

      getInstance: (sandbox: E2BSandbox): E2BSandbox => sandbox,
    },

    snapshot: {
      create: async (config: LelantosConfig, sandboxId: string, options?: { name?: string }) => {
        try {
          const sandbox = await E2BSandbox.connect(sandboxId, connectOpts(config));
          const snapshotSandbox = sandbox as SnapshotCapableE2BSandbox;
          const snapshotResult = await snapshotSandbox.createSnapshot({ name: options?.name });
          const snapshotId = typeof snapshotResult === 'string'
            ? snapshotResult
            : (() => {
                const r = snapshotResult as { snapshotId?: string; id?: string; templateId?: string };
                return r.snapshotId || r.id || r.templateId;
              })();
          return { id: snapshotId, provider: 'lelantos', createdAt: new Date(), metadata: { name: options?.name } };
        } catch (error) {
          throw new Error(`Failed to create Lelantos snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (config: LelantosConfig) => {
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.listTemplates === 'function') {
            return await e2bStatic.listTemplates(connectOpts(config));
          }
          return [];
        } catch { return []; }
      },
      delete: async (config: LelantosConfig, snapshotId: string) => {
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.deleteTemplate === 'function') {
            await e2bStatic.deleteTemplate(snapshotId, connectOpts(config));
          }
        } catch { /* ignore */ }
      }
    },

    template: {
      create: async (_config: LelantosConfig, _options: { name: string }) => {
        throw new Error('To create a template in Lelantos, create a snapshot from a running sandbox using snapshot.create(), or use the E2B-compatible template build protocol / CLI to build from a Dockerfile.');
      },
      list: async (config: LelantosConfig) => {
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.listTemplates === 'function') return await e2bStatic.listTemplates(connectOpts(config));
          return [];
        } catch { return []; }
      },
      delete: async (config: LelantosConfig, templateId: string) => {
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.deleteTemplate === 'function') await e2bStatic.deleteTemplate(templateId, connectOpts(config));
        } catch { /* ignore */ }
      }
    }
  }
});

export type { Sandbox as E2BSandbox } from 'e2b';

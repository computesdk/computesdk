/**
 * Promigence provider for ComputeSDK.
 *
 * Production-grade sandboxes for AI agents, with filesystem access and streaming output. Every
 * operation goes through the Promigence SDK (`@promigence/sdk`).
 */

import { defineProvider, escapeShellArg, TIMEOUT_EXIT_CODE } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  InstanceInfo,
  RunCommandOptions,
} from '@computesdk/provider';
import {
  CommandExitError,
  CommandTimeoutError,
  NotFoundError,
  PromigenceClient,
  PromigenceError,
  Sandbox,
} from '@promigence/sdk';
import type {
  CommandHandle,
  CommandResult as PromigenceCommandResult,
  CommandRunOpts,
  EntryInfo,
  OptimizeFor,
  SandboxCreateOpts,
  SandboxRecord,
  SnapshotRecord,
  Tier,
} from '@promigence/sdk';

/** Configuration for `promigence(config)`. Every field is optional. */
export interface PromigenceConfig {
  /** Promigence API key. Falls back to `PROMIGENCE_API_KEY`, then to the key `promigence login` stored. */
  apiKey?: string;
  /** Promigence API URL. Falls back to `PROMIGENCE_API_URL`, then to the default Promigence API. */
  apiUrl?: string;
  /**
   * The most one sandbox may spend, in US dollars. Falls back to `PROMIGENCE_SPEND_CAP`, then to
   * your organization's default cap.
   */
  spendCap?: number;
  /**
   * The snapshot `create()` starts from when it names none: its id (`snap_...`), its alias, or
   * `alias@commit`. Default: the built-in base snapshot.
   */
  snapshot?: string;
  /**
   * Sandbox lifetime in milliseconds when `create()` sets none; also the bound on a command that
   * sets none. Default: your account's.
   */
  timeout?: number;
  /** Size of a sandbox created from an `image`. A sandbox from a snapshot has that snapshot's size. */
  tier?: Tier;
  /** `'start'` (the default) or `'compute'` (long, memory-heavy jobs on the larger tiers). */
  optimizeFor?: OptimizeFor;
  /** A Promigence SDK client to use instead of one built from `apiKey` and `apiUrl`. */
  client?: PromigenceClient;
}

/** What `sandbox.getInstance()` returns: the Promigence SDK sandbox, its client and the provider config. */
export interface PromigenceInstance {
  sandbox: Sandbox;
  client: PromigenceClient;
  config: PromigenceConfig;
}

/** `create()` options ComputeSDK does not name; they arrive through its index signature. */
interface PromigenceCreateOptions {
  spendCap?: unknown;
  tier?: Tier;
  optimizeFor?: OptimizeFor;
  allowInternetAccess?: boolean;
  allowHosts?: string[];
  registrySecret?: string;
}

const PROVIDER = 'promigence';

/** Every state a sandbox reports before it has ended. */
const LIVE_STATES = ['queued', 'ready', 'running', 'paused'];

const TEMPLATE_FIX =
  'Pass a snapshot id or alias to create() as templateId, list snapshots with snapshot.list(), ' +
  'and build snapshots with the Promigence CLI (promigence snapshot create).';

function fromEnv(name: string): string | undefined {
  const value = typeof process === 'undefined' ? undefined : process.env?.[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function promigenceError(
  message: string,
  detail: { name?: string; code?: string; fix?: string; cause?: unknown } = {}
): Error {
  const { name, ...rest } = detail;
  const err = new Error(message);
  if (name) err.name = name;
  return Object.assign(err, rest);
}

function invalidArgument(message: string, fix: string): Error {
  return promigenceError(`${message}. ${fix}`, { name: 'InvalidArgumentError', code: 'invalid_argument', fix });
}

function unsupported(message: string, fix: string): Error {
  return promigenceError(`${message} ${fix}`, { name: 'UnsupportedError', code: 'unsupported', fix });
}

/** A Promigence error, re-thrown with the operation named; its `code`, `fix` and the original (`cause`) are kept. */
function rethrow(e: unknown, what: string): never {
  if (e instanceof PromigenceError) {
    const detail = [e.message.replace(/\.+$/, ''), e.fix].filter((part) => part.length > 0).join('. ');
    throw promigenceError(`Promigence ${what} failed (${e.code}): ${detail}`, {
      name: e.name,
      code: e.code,
      fix: e.fix,
      cause: e,
    });
  }
  throw e;
}

function checkString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw invalidArgument(`Promigence: '${field}' must be a string, got ${typeof value}`, `Pass '${field}' as a string, or leave it unset.`);
  }
}

function checkSpendCap(value: unknown, from: string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw invalidArgument(
    `Promigence: ${from} must be a number of US dollars, 0 or more, got ${show(value)}`,
    "Pass the most one sandbox may spend, or leave it unset to use your organization's default cap."
  );
}

/** Checks the provider config before anything is sent. */
function checkConfig(config: PromigenceConfig): void {
  checkString(config.apiKey, 'apiKey');
  checkString(config.apiUrl, 'apiUrl');
  checkString(config.snapshot, 'snapshot');
  checkString(config.tier, 'tier');
  checkString(config.optimizeFor, 'optimizeFor');

  const apiUrl = config.apiUrl?.trim() || fromEnv('PROMIGENCE_API_URL');
  if (apiUrl !== undefined) {
    const from = config.apiUrl?.trim() ? "'apiUrl'" : 'PROMIGENCE_API_URL';
    let protocol = '';
    try {
      protocol = new URL(apiUrl).protocol;
    } catch {
      // reported below
    }
    if (protocol !== 'https:' && protocol !== 'http:') {
      throw invalidArgument(
        `Promigence: ${from} must be an http(s) URL, got ${show(apiUrl)}`,
        'Leave it unset to use the default Promigence API.'
      );
    }
  }

  if (config.spendCap !== undefined) checkSpendCap(config.spendCap, "'spendCap'");

  const timeout: unknown = config.timeout;
  if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0)) {
    throw invalidArgument(
      `Promigence: 'timeout' must be a number of milliseconds above 0, got ${show(timeout)}`,
      "Pass the sandbox lifetime in milliseconds, or leave it unset to use your account's default."
    );
  }
}

function missingKey(client: PromigenceClient): Error {
  const problem = client.credentialsProblem;
  if (problem) {
    return promigenceError(`Promigence did not use the API key it found: ${problem.message}. ${problem.fix}`, {
      name: problem.name,
      code: problem.code,
      fix: problem.fix,
      cause: problem,
    });
  }
  const fix =
    "Pass it: promigence({ apiKey: 'prom_api_...' })\n" +
    'Or set PROMIGENCE_API_KEY in your environment.\n' +
    'Or sign in once with the Promigence CLI (npm install -g promigence, then promigence login); ' +
    'the key it stores is used when neither is set.\n' +
    'New to Promigence? promigence signup creates an account: https://www.promigence.ai/docs/quickstart';
  return promigenceError(`Missing Promigence API key.\n\n${fix}`, { name: 'AuthError', code: 'auth', fix });
}

const clients = new WeakMap<PromigenceConfig, PromigenceClient>();

/** The client for one provider config, built on first use, once the config has been checked. */
function clientFor(config: PromigenceConfig): PromigenceClient {
  const cached = clients.get(config);
  if (cached) return cached;
  checkConfig(config);
  const apiKey = config.apiKey?.trim() || fromEnv('PROMIGENCE_API_KEY');
  const apiUrl = config.apiUrl?.trim() || fromEnv('PROMIGENCE_API_URL');
  const client =
    config.client ??
    new PromigenceClient({
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(apiUrl === undefined ? {} : { apiUrl }),
    });
  if (!client.authenticated) throw missingKey(client);
  clients.set(config, client);
  return client;
}

/** The spend cap for one `create()`: its own option, then the config, then `PROMIGENCE_SPEND_CAP`. */
function spendCapFor(option: unknown, config: PromigenceConfig): number | undefined {
  if (option !== undefined) return checkSpendCap(option, "the create() option 'spendCap'");
  if (config.spendCap !== undefined) return config.spendCap;
  const env = fromEnv('PROMIGENCE_SPEND_CAP');
  return env === undefined ? undefined : checkSpendCap(Number(env), `PROMIGENCE_SPEND_CAP (${show(env)})`);
}

/** ComputeSDK `metadata` becomes the sandbox's labels, which are strings. */
function labelsOf(metadata: unknown): Record<string, string> | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    labels[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

/** The SDK options for one command: its own timeout, else the provider config's. */
function runOpts(options: RunCommandOptions | undefined, config: PromigenceConfig): Omit<CommandRunOpts, 'background'> {
  const timeoutMs = options?.timeout ?? config.timeout;
  return {
    throwOnExit: false,
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options?.env && Object.keys(options.env).length > 0 ? { envs: options.env } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function toComputeResult(r: PromigenceCommandResult, startedAt: number): CommandResult {
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: Date.now() - startedAt };
}

function toFileEntry(e: EntryInfo): FileEntry {
  return { name: e.name, type: e.type === 'dir' ? 'directory' : 'file', size: e.size, modified: e.modifiedTime };
}

function createdAtOf(rec: SandboxRecord): Date {
  if (typeof rec.created_at === 'string') {
    const date = new Date(rec.created_at);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(0);
}

/** Runs a filesystem command; a non-zero exit is an error that names the operation. */
async function execOrThrow(inst: PromigenceInstance, command: string, what: string): Promise<void> {
  let r: PromigenceCommandResult;
  try {
    r = await inst.sandbox.commands.run(command, { throwOnExit: false });
  } catch (e) {
    rethrow(e, what);
  }
  if (r.exitCode !== 0) {
    throw promigenceError(`Promigence ${what} failed (exit ${r.exitCode}): ${r.stderr.trim()}`);
  }
}

function toSnapshotInfo(s: SnapshotRecord) {
  return {
    id: s.snapshot_id,
    provider: PROVIDER,
    createdAt: typeof s.created_at === 'string' ? new Date(s.created_at) : new Date(0),
    metadata: {
      ...(s.alias ? { alias: s.alias } : {}),
      ...(s.repo ? { repo: s.repo } : {}),
      ...(s.commit ? { commit: s.commit } : {}),
      ...(s.tier ? { tier: s.tier } : {}),
      ...(typeof s.verified === 'boolean' ? { verified: s.verified } : {}),
    },
  };
}

/** The ComputeSDK provider: `promigence({ apiKey })`, or `promigence({})` to read the environment. */
export const promigence = defineProvider<PromigenceInstance, PromigenceConfig>({
  name: PROVIDER,
  methods: {
    instances: {
      create: async (config: PromigenceConfig, options?: CreateInstanceOptions) => {
        const client = clientFor(config);
        const o = (options ?? {}) as CreateInstanceOptions & PromigenceCreateOptions;
        const snapshot = o.templateId ?? o.snapshotId;
        if (o.image !== undefined && snapshot !== undefined) {
          throw invalidArgument(
            "Promigence: create() takes 'image' or a snapshot ('templateId' / 'snapshotId'), not both",
            'Pass one of them.'
          );
        }
        const timeoutMs = o.timeout ?? config.timeout;
        const spendCap = spendCapFor(o.spendCap, config);
        const tier = o.tier ?? config.tier;
        const optimizeFor = o.optimizeFor ?? config.optimizeFor;
        const labels = labelsOf(o.metadata);

        const opts: SandboxCreateOpts = {
          client,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(spendCap === undefined ? {} : { spendCap }),
          ...(o.envs === undefined ? {} : { envs: o.envs }),
          ...(labels === undefined ? {} : { metadata: labels }),
          ...(o.allowInternetAccess === undefined ? {} : { allowInternetAccess: o.allowInternetAccess }),
          ...(Array.isArray(o.allowHosts) && o.allowHosts.length > 0 ? { allowHosts: o.allowHosts } : {}),
          ...(optimizeFor === undefined ? {} : { optimizeFor }),
        };
        if (o.image !== undefined) {
          // Passing an image asks for its snapshot: built on first use, reused after.
          opts.image = o.image;
          opts.allowBuild = true;
          if (tier !== undefined) opts.tier = tier;
          if (typeof o.registrySecret === 'string') opts.registrySecret = o.registrySecret;
        }

        let sandbox: Sandbox;
        try {
          sandbox =
            o.image !== undefined
              ? await Sandbox.create(opts)
              : await Sandbox.create(snapshot ?? config.snapshot ?? 'base', opts);
        } catch (e) {
          rethrow(e, 'sandbox create');
        }
        return { instance: { sandbox, client, config }, instanceId: sandbox.sandboxId };
      },

      getById: async (config: PromigenceConfig, instanceId: string) => {
        const client = clientFor(config);
        try {
          const sandbox = await Sandbox.connect(instanceId, { client });
          return { instance: { sandbox, client, config }, instanceId: sandbox.sandboxId };
        } catch (e) {
          if (e instanceof NotFoundError) return null;
          rethrow(e, 'sandbox lookup');
        }
      },

      list: async (config: PromigenceConfig) => {
        const client = clientFor(config);
        const records: SandboxRecord[] = [];
        try {
          let cursor: string | null = null;
          do {
            const page = await Sandbox.listPage({ client, state: LIVE_STATES, ...(cursor ? { cursor } : {}) });
            records.push(...page.items);
            cursor = page.nextCursor;
          } while (cursor);
        } catch (e) {
          rethrow(e, 'sandbox list');
        }
        const sandboxes = await Promise.all(
          records
            .filter((r) => r.state !== 'ended')
            .map(async (r) => {
              try {
                return await Sandbox.connect(r.sandbox_id, { client });
              } catch (e) {
                if (e instanceof NotFoundError) return undefined;
                rethrow(e, 'sandbox lookup');
              }
            })
        );
        return sandboxes
          .filter((s): s is Sandbox => s !== undefined)
          .map((sandbox) => ({ instance: { sandbox, client, config }, instanceId: sandbox.sandboxId }));
      },

      destroy: async (config: PromigenceConfig, instanceId: string) => {
        const client = clientFor(config);
        try {
          await client.sandboxes.kill(instanceId);
        } catch (e) {
          // Already gone is what destroy asks for.
          if (e instanceof NotFoundError) return;
          rethrow(e, 'sandbox destroy');
        }
      },

      runCommand: async (inst: PromigenceInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startedAt = Date.now();
        if (options?.background) {
          // Started and left running; its output is not collected.
          try {
            await inst.sandbox.commands.run(command, { ...runOpts(options, inst.config), background: true });
            return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startedAt };
          } catch (e) {
            rethrow(e, 'background command');
          }
        }
        try {
          const r = await inst.sandbox.commands.run(command, runOpts(options, inst.config));
          return toComputeResult(r, startedAt);
        } catch (e) {
          if (e instanceof CommandExitError) {
            return { stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode, durationMs: Date.now() - startedAt };
          }
          rethrow(e, 'command');
        }
      },

      /**
       * `onStdout` / `onStderr` receive the output while the command runs. A command that outruns
       * its `timeout` is stopped and reported with exit code 124.
       */
      streamCommand: async (inst: PromigenceInstance, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        const startedAt = Date.now();
        let handle: CommandHandle;
        try {
          handle = await inst.sandbox.commands.run(command, {
            ...runOpts(options, inst.config),
            background: true,
            ...(options.onStdout ? { onStdout: options.onStdout } : {}),
            ...(options.onStderr ? { onStderr: options.onStderr } : {}),
          });
        } catch (e) {
          rethrow(e, 'command');
        }
        let timedOut = false;
        const timer =
          options.timeout === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                void handle.kill().catch(() => undefined);
              }, options.timeout);
        try {
          return toComputeResult(await handle.wait(), startedAt);
        } catch (e) {
          if (e instanceof CommandExitError) {
            const pastTimeout = timedOut || e instanceof CommandTimeoutError;
            return {
              stdout: e.stdout,
              stderr: e.stderr,
              exitCode: pastTimeout ? TIMEOUT_EXIT_CODE : e.exitCode,
              durationMs: Date.now() - startedAt,
            };
          }
          rethrow(e, 'command');
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      },

      getInfo: async (inst: PromigenceInstance): Promise<InstanceInfo> => {
        let rec: SandboxRecord;
        try {
          rec = await inst.sandbox.getInfo();
        } catch (e) {
          rethrow(e, 'sandbox info');
        }
        return {
          id: inst.sandbox.sandboxId,
          provider: PROVIDER,
          status: rec.state === 'ended' ? 'stopped' : 'running',
          createdAt: createdAtOf(rec),
          timeout: typeof rec.timeout_ms === 'number' ? rec.timeout_ms : (inst.config.timeout ?? 0),
          metadata: {
            state: rec.state,
            runId: inst.sandbox.runId,
            snapshot: inst.sandbox.snapshot,
            ...(rec.outcome === undefined ? {} : { outcome: rec.outcome }),
          },
        };
      },

      getUrl: async (_inst: PromigenceInstance, options: { port: number; protocol?: string }): Promise<string> => {
        throw unsupported(
          `Promigence does not offer preview URLs yet, so getUrl() has no URL for port ${options.port}.`,
          `To reach a server in the sandbox, call it from a command in the same sandbox, for example with curl on port ${options.port}.`
        );
      },

      getInstance: (inst: PromigenceInstance): PromigenceInstance => inst,

      filesystem: {
        readFile: async (inst: PromigenceInstance, path: string): Promise<string> => {
          try {
            return await inst.sandbox.files.read(path);
          } catch (e) {
            rethrow(e, `read of ${path}`);
          }
        },
        writeFile: async (inst: PromigenceInstance, path: string, content: string): Promise<void> => {
          try {
            await inst.sandbox.files.write(path, content);
          } catch (e) {
            rethrow(e, `write of ${path}`);
          }
        },
        mkdir: (inst: PromigenceInstance, path: string): Promise<void> =>
          execOrThrow(inst, `mkdir -p -- "${escapeShellArg(path)}"`, `mkdir of ${path}`),
        readdir: async (inst: PromigenceInstance, path: string): Promise<FileEntry[]> => {
          try {
            return (await inst.sandbox.files.list(path)).map(toFileEntry);
          } catch (e) {
            rethrow(e, `listing of ${path}`);
          }
        },
        exists: async (inst: PromigenceInstance, path: string): Promise<boolean> => {
          try {
            return await inst.sandbox.files.exists(path);
          } catch (e) {
            rethrow(e, `check of ${path}`);
          }
        },
        // ComputeSDK's remove takes directories too.
        remove: (inst: PromigenceInstance, path: string): Promise<void> =>
          execOrThrow(inst, `rm -rf -- "${escapeShellArg(path)}"`, `remove of ${path}`),
      },
    },

    snapshot: {
      create: async (_config: PromigenceConfig, instanceId: string) => {
        throw unsupported(
          `Promigence does not create a snapshot from a running sandbox (${instanceId}).`,
          'Build one with the Promigence CLI (promigence snapshot create --image <image>) and pass its id or ' +
            'alias to create() as templateId or snapshotId, or pass an image to create().'
        );
      },
      list: async (config: PromigenceConfig) => {
        const client = clientFor(config);
        let records: SnapshotRecord[];
        try {
          records = await client.snapshots.list();
        } catch (e) {
          rethrow(e, 'snapshot list');
        }
        return records.map(toSnapshotInfo);
      },
      delete: async (config: PromigenceConfig, snapshotId: string) => {
        const client = clientFor(config);
        try {
          await client.snapshots.delete(snapshotId);
        } catch (e) {
          if (e instanceof NotFoundError) return;
          rethrow(e, 'snapshot delete');
        }
      },
    },

    template: {
      create: async () => {
        throw unsupported('Promigence has no templates of its own: a template is a snapshot.', TEMPLATE_FIX);
      },
      list: async () => {
        throw unsupported('Promigence has no templates of its own: a template is a snapshot.', TEMPLATE_FIX);
      },
      delete: async () => {
        throw unsupported('Promigence has no templates of its own: a template is a snapshot.', TEMPLATE_FIX);
      },
    },
  },
});

export { PromigenceClient, PromigenceError, Sandbox as PromigenceSandbox } from '@promigence/sdk';

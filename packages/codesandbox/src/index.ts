/**
 * Codesandbox Provider - Factory-based Implementation
 */

import { CodeSandbox } from '@codesandbox/sdk';
import type { Sandbox as CodesandboxNativeSandbox, SandboxClient } from '@codesandbox/sdk';
import { defineProvider } from '@computesdk/provider';

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

export interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * The CodeSandbox SDK sandbox, plus `pause()` (hibernate: memory and disk are
 * kept) and `resume()` (wake the same sandbox id).
 */
export type CodesandboxSandbox = CodesandboxNativeSandbox & {
  pause(): Promise<void>;
  resume(): Promise<void>;
};

/** Tag carried by sandboxes that serve as snapshots (hibernated forks). */
const SNAPSHOT_TAG = 'computesdk-snapshot';

interface SandboxState {
  sdk: CodeSandbox;
  /** Latest SDK handle for this sandbox id (replaced on resume). */
  current: CodesandboxNativeSandbox;
  client?: Promise<SandboxClient>;
}

const states = new WeakMap<CodesandboxNativeSandbox, SandboxState>();
/** Open clients by sandbox id, so destroy can close the session before deleting. */
const openClients = new Map<string, Promise<SandboxClient>>();

function resolveApiKey(config: CodesandboxConfig): string {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
  if (!apiKey) {
    throw new Error(`Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`);
  }
  return apiKey;
}

function sdkFor(config: CodesandboxConfig): CodeSandbox {
  return new CodeSandbox(resolveApiKey(config));
}

async function closeClient(sandboxId: string): Promise<void> {
  const client = openClients.get(sandboxId);
  if (!client) return;
  openClients.delete(sandboxId);
  try {
    const open = await client;
    await open.disconnect().catch(() => undefined);
    open.dispose();
  } catch { /* already gone */ }
}

function track(sdk: CodeSandbox, native: CodesandboxNativeSandbox): CodesandboxSandbox {
  const state: SandboxState = { sdk, current: native };
  states.set(native, state);
  const sandbox = native as CodesandboxSandbox;
  Object.defineProperty(sandbox, 'pause', {
    configurable: true,
    value: async () => {
      await closeClient(sandbox.id);
      state.client = undefined;
      await sdk.sandboxes.hibernate(sandbox.id);
    },
  });
  Object.defineProperty(sandbox, 'resume', {
    configurable: true,
    value: async () => {
      await closeClient(sandbox.id);
      state.client = undefined;
      state.current = await sdk.sandboxes.resume(sandbox.id);
    },
  });
  return sandbox;
}

function getClient(sandbox: CodesandboxNativeSandbox): Promise<SandboxClient> {
  const state = states.get(sandbox);
  if (!state) return sandbox.connect();
  if (!state.client) {
    const client = state.current.connect();
    state.client = client;
    openClients.set(sandbox.id, client);
    client.catch(() => {
      if (state.client === client) state.client = undefined;
      if (openClients.get(sandbox.id) === client) openClients.delete(sandbox.id);
    });
  }
  return state.client;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function randomToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Exit code `timeout(1)` reports when it stops a command. */
const TIMEOUT_EXIT_CODE = 124;

/**
 * `commands.run` executes in a terminal: stdout and stdin are a TTY, stdout and
 * stderr are merged with CRLF line endings, a non-zero exit throws with the
 * output dropped, and a command that finishes before the SDK subscribes to it
 * can lose its output or never report its exit. So the
 * command runs with stdin from /dev/null and stdout and stderr captured to
 * files; the exit code and base64 of both streams are written between two
 * markers to a result file, which is printed and, if the printed copy is
 * missing, read back; the file appearing also counts as completion. The marker is printed in two pieces so it never appears
 * verbatim in the command text.
 */
function wrapCommand(command: string, token: string, timeoutMs?: number): string {
  const out = `/tmp/.computesdk-${token}.out`;
  const err = `/tmp/.computesdk-${token}.err`;
  const marker = `'__CSDK_' '${token}__'`;
  const body = timeoutMs && timeoutMs > 0
    ? `if command -v timeout >/dev/null 2>&1; then timeout -k 2 ${Math.max(1, Math.ceil(timeoutMs / 1000))} bash -c ${shQuote(command)}; else bash -c ${shQuote(command)}; fi`
    : command;
  return [
    `(\n${body}\n) </dev/null >${out} 2>${err}; __csdk_ec=$?`,
    `{ printf '%s%s%s:' ${marker} "$__csdk_ec"; base64 ${out} | tr -d '\\n'; printf ':'; base64 ${err} | tr -d '\\n'; printf '%s%s' ${marker}; } >${resultPath(token)}.tmp`,
    `mv -f ${resultPath(token)}.tmp ${resultPath(token)}; rm -f ${out} ${err}; cat ${resultPath(token)}`,
  ].join('; ');
}

function resultPath(token: string): string {
  return `/tmp/.computesdk-${token}.res`;
}

function parseWrapped(output: string, marker: string): { stdout: string; stderr: string; exitCode: number } | undefined {
  const flat = output.replace(/[\r\n]/g, '');
  const start = flat.indexOf(marker);
  if (start === -1) return undefined;
  const end = flat.indexOf(marker, start + marker.length);
  if (end === -1) return undefined;
  const [code, out = '', err = ''] = flat.slice(start + marker.length, end).split(':');
  const exitCode = Number.parseInt(code, 10);
  if (!Number.isFinite(exitCode)) return undefined;
  return {
    stdout: Buffer.from(out, 'base64').toString('utf8'),
    stderr: Buffer.from(err, 'base64').toString('utf8'),
    exitCode,
  };
}

/**
 * Runs a wrapped command and resolves with its printed output once the SDK
 * reports it finished or its result file exists (`''` if only the file did),
 * or `undefined` past `timeoutMs`.
 */
async function runToCompletion(
  client: SandboxClient,
  wrapped: string,
  runOpts: { env?: Record<string, string>; cwd?: string },
  resultFile: string,
  timeoutMs?: number,
): Promise<string | undefined> {
  const cmd = await client.commands.runBackground(wrapped, runOpts);
  let settled = false;
  const finished = cmd.waitUntilComplete().then(
    (output) => output,
    (error) => (typeof (error as any)?.output === 'string' ? (error as any).output : ''),
  );
  const polled = (async () => {
    for (let delay = 100; !settled; delay = Math.min(delay * 2, 1000)) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (settled) break;
      const exists = await client.fs.stat(resultFile).then(() => true, () => false);
      if (exists) {
        // The SDK missed the exit; drop its shell so its listeners go too.
        cmd.kill().catch(() => undefined);
        return '';
      }
    }
    return '';
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = timeoutMs === undefined
    ? undefined
    : new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); });
  try {
    return await Promise.race([finished, polled, ...(deadline ? [deadline] : [])]);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

export const codesandbox = defineProvider<CodesandboxSandbox, CodesandboxConfig, any, any>({
  name: 'codesandbox',
  methods: {
    instances: {
      create: async (config: CodesandboxConfig, options?: CreateInstanceOptions) => {
        const sdk = sdkFor(config);
        try {
          const {
            timeout: _timeout, envs, name: _name, metadata: _metadata,
            templateId: optTemplateId, snapshotId, sandboxId: _sandboxId,
            namespace: _namespace, directory: _directory, ...providerOptions
          } = options || {};
          const createOptions: any = { ...providerOptions };
          // A snapshot is a hibernated fork: restoring forks it again, so the
          // snapshot stays reusable and every restore is a new sandbox.
          const templateId = snapshotId || optTemplateId || config.templateId;
          if (templateId) createOptions.id = templateId;
          if (envs && Object.keys(envs).length > 0) createOptions.envVars = envs;
          const sandbox = await sdk.sandboxes.create(createOptions);
          return { instance: track(sdk, sandbox), instanceId: sandbox.id };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/unauthori[sz]ed|API key/i.test(message)) {
            throw new Error(`CodeSandbox authentication failed. Please check your CSB_API_KEY environment variable. (${message})`);
          }
          throw new Error(`Failed to create CodeSandbox sandbox: ${message}`);
        }
      },

      getById: async (config: CodesandboxConfig, sandboxId: string) => {
        const sdk = sdkFor(config);
        try {
          const sandbox = await sdk.sandboxes.resume(sandboxId);
          return { instance: track(sdk, sandbox), instanceId: sandboxId };
        } catch { return null; }
      },

      list: async (_config: CodesandboxConfig) => {
        throw new Error(`CodeSandbox provider does not support listing sandboxes.`);
      },

      destroy: async (config: CodesandboxConfig, sandboxId: string) => {
        const sdk = sdkFor(config);
        // Deleting a running VM intermittently fails with "An unexpected error
        // occurred", so close our session and shut the VM down first, then retry.
        await closeClient(sandboxId);
        try { await sdk.sandboxes.shutdown(sandboxId); } catch { /* delete reports the real error */ }
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await sdk.sandboxes.delete(sandboxId);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/not found|404/i.test(message)) return;
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
          }
        }
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Failed to delete CodeSandbox sandbox "${sandboxId}": ${message}`);
      },

      runCommand: async (sandbox: CodesandboxSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        const runOpts: { env?: Record<string, string>; cwd?: string } = {};
        if (options?.env && Object.keys(options.env).length > 0) runOpts.env = options.env;
        if (options?.cwd) runOpts.cwd = options.cwd;
        try {
          const client = await getClient(sandbox);
          if (options?.background) {
            await client.commands.runBackground(`setsid bash -c ${shQuote(command)} </dev/null >/dev/null 2>&1 &`, runOpts);
            return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
          }
          const token = randomToken();
          const marker = `__CSDK_${token}__`;
          const clientTimeoutMs = options?.timeout && options.timeout > 0 ? options.timeout + 10_000 : undefined;
          const output = await runToCompletion(client, wrapCommand(command, token, options?.timeout), runOpts, resultPath(token), clientTimeoutMs);
          if (output === undefined) {
            return { stdout: '', stderr: `Command timed out after ${options!.timeout}ms`, exitCode: TIMEOUT_EXIT_CODE, durationMs: Date.now() - startTime };
          }
          let parsed = parseWrapped(output, marker);
          if (!parsed) {
            const saved = await client.fs.readTextFile(resultPath(token)).catch(() => undefined);
            parsed = saved === undefined ? undefined : parseWrapped(saved, marker);
          }
          client.fs.remove(resultPath(token)).catch(() => undefined);
          if (!parsed) {
            return { stdout: output.replace(/\r\n/g, '\n'), stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
          }
          return { ...parsed, durationMs: Date.now() - startTime };
        } catch (error) {
          const exitCode = typeof (error as any)?.exitCode === 'number' ? (error as any).exitCode : 127;
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: CodesandboxSandbox): Promise<InstanceInfo> => ({
        id: sandbox.id,
        provider: 'codesandbox',
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: { cluster: sandbox.cluster, bootupType: sandbox.bootupType, isUpToDate: sandbox.isUpToDate }
      }),

      getUrl: async (sandbox: CodesandboxSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const protocol = options.protocol || 'https';
        return `${protocol}://${sandbox.id}.${sandbox.cluster}.csb.app:${options.port}`;
      },

      filesystem: {
        readFile: async (sandbox: CodesandboxSandbox, path: string): Promise<string> => {
          const client = await getClient(sandbox);
          return client.fs.readTextFile(path);
        },
        writeFile: async (sandbox: CodesandboxSandbox, path: string, content: string): Promise<void> => {
          const client = await getClient(sandbox);
          await client.fs.writeTextFile(path, content);
        },
        mkdir: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          const client = await getClient(sandbox);
          await client.fs.mkdir(path, true);
        },
        readdir: async (sandbox: CodesandboxSandbox, path: string): Promise<FileEntry[]> => {
          const client = await getClient(sandbox);
          const entries = await client.fs.readdir(path);
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.type === 'directory' ? 'directory' as const : 'file' as const,
            size: 0,
            modified: new Date()
          }));
        },
        exists: async (sandbox: CodesandboxSandbox, path: string): Promise<boolean> => {
          const client = await getClient(sandbox);
          try { await client.fs.stat(path); return true; } catch { return false; }
        },
        remove: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          const client = await getClient(sandbox);
          await client.fs.remove(path, true);
        }
      },

      getInstance: (sandbox: CodesandboxSandbox): CodesandboxSandbox => sandbox,
    },

    snapshot: {
      // A fork of the running sandbox (memory, processes and disk), hibernated
      // so it persists as a restore point independent of the source.
      create: async (config: CodesandboxConfig, sandboxId: string, options?: { name?: string }) => {
        const sdk = sdkFor(config);
        try {
          const fork = await sdk.sandboxes.create({
            id: sandboxId,
            tags: [SNAPSHOT_TAG],
            ...(options?.name ? { title: options.name } : {}),
          });
          await sdk.sandboxes.hibernate(fork.id);
          return { id: fork.id, provider: 'codesandbox', createdAt: new Date(), metadata: { name: options?.name, sourceSandboxId: sandboxId } };
        } catch (error) {
          throw new Error(`Failed to create CodeSandbox snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (config: CodesandboxConfig) => {
        const sdk = sdkFor(config);
        const { sandboxes } = await sdk.sandboxes.list({ tags: [SNAPSHOT_TAG] });
        return sandboxes
          .filter((s) => s.tags?.includes(SNAPSHOT_TAG))
          .map((s) => ({ id: s.id, provider: 'codesandbox', createdAt: s.createdAt, metadata: { name: s.title } }));
      },
      delete: async (config: CodesandboxConfig, snapshotId: string) => {
        const sdk = sdkFor(config);
        try {
          await sdk.sandboxes.delete(snapshotId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/not found|404/i.test(message)) {
            throw new Error(`Failed to delete CodeSandbox snapshot "${snapshotId}": ${message}`);
          }
        }
      }
    },

    template: {
      create: async (_config: CodesandboxConfig, _options: { name: string }) => {
        throw new Error(`CodeSandbox templates must be created via the dashboard.`);
      },
      list: async (_config: CodesandboxConfig) => { throw new Error(`CodeSandbox provider does not support listing templates via API.`); },
      delete: async (_config: CodesandboxConfig, _templateId: string) => { throw new Error(`CodeSandbox templates must be deleted via the dashboard.`); }
    }
  }
});

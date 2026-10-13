import { LizardError, NotFoundError, Sandbox } from '@lizard-build/sdk';
import type { ConnectionOpts, SandboxInfo, SandboxOpts, SandboxSnapshot } from '@lizard-build/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

export interface LizardConfig {
  /** API key, or LIZARD_API_KEY. Prefer a key scoped to this project. */
  apiKey?: string;
  /** Exact project ID, or LIZARD_PROJECT_ID. */
  projectId?: string;
  /** API endpoint, or LIZARD_API_URL. Defaults to https://lizard.build. */
  apiUrl?: string;
  /** Built-in template. Defaults to interpreter (Python and Node.js). */
  template?: string;
  /** Sandbox lifetime in milliseconds; 0 disables the deadline. */
  timeout?: number;
  /** Machine size. Defaults to the service's medium size. */
  size?: SandboxOpts['size'];
  region?: string;
}

function connection(config: LizardConfig): ConnectionOpts {
  const apiKey = config.apiKey ?? process.env.LIZARD_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('Set LIZARD_API_KEY or pass apiKey. Create a project-scoped key with Lizard CLI: lizard keys create computesdk --project <project-id>.');
  }
  return { apiKey, apiUrl: config.apiUrl ?? process.env.LIZARD_API_URL };
}

function projectId(config: LizardConfig): string {
  const value = config.projectId ?? process.env.LIZARD_PROJECT_ID;
  if (!value?.trim()) throw new Error('Set LIZARD_PROJECT_ID or pass projectId with the exact Lizard project ID.');
  return value;
}

function lifetime(value: number): number {
  if (!Number.isInteger(value) || (value !== 0 && (value < 1000 || value > 2147483647))) {
    throw new Error('Sandbox timeout must be 0 or an integer from 1000 through 2147483647 milliseconds.');
  }
  return value;
}

function size(value: unknown): SandboxOpts['size'] {
  if (value === undefined) return undefined;
  if (value === 'small' || value === 'medium' || value === 'large') return value;
  throw new Error('Lizard size must be small, medium, or large.');
}

function metadata(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error('Lizard metadata values must be strings.');
    result[key] = item;
  }
  return result;
}

async function runCommand(
  sandbox: Sandbox, command: string, options: RunCommandOptions = {},
): Promise<CommandResult> {
  if (options.timeout !== undefined && (!Number.isInteger(options.timeout) || options.timeout < 1000 || options.timeout > 600000)) {
    throw new Error('Command timeout must be an integer from 1000 through 600000 milliseconds.');
  }
  if (options.background && (options.onStdout || options.onStderr)) {
    throw new Error('Streaming a detached background command is not supported.');
  }
  const started = Date.now();
  const cmd = options.background
    ? `nohup sh -c "${escapeShellArg(command)}" </dev/null >/dev/null 2>&1 &`
    : command;
  const streaming = Boolean(options.onStdout || options.onStderr);
  let pid: number | undefined;
  // SDK callbacks carry lines, while ComputeSDK callbacks carry chunks.
  // Keep trailing whitespace pending to match the SDK's trimEnd() result.
  const stream = (callback?: (chunk: string) => void) => {
    let seen = false;
    let pending = '';
    let output = '';
    return {
      line: (line: string) => {
        const text = pending + (seen ? '\n' : '') + line;
        seen = true;
        const chunk = text.trimEnd();
        pending = text.slice(chunk.length);
        output += chunk;
        if (chunk) callback?.(chunk);
      },
      output: () => output,
    };
  };
  const stdout = stream(options.onStdout);
  const stderr = stream(options.onStderr);
  let result;
  try {
    result = await sandbox.process.exec(cmd, {
      timeoutMs: options.timeout,
      workdir: options.cwd,
      envs: options.env,
      onStdout: streaming ? stdout.line : undefined,
      onStderr: streaming ? stderr.line : undefined,
      onPid: streaming ? value => { pid = value; } : undefined,
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'TimeoutError') || pid === undefined) throw error;
    // Stop this command's process tree before reporting the deadline.
    try { await sandbox.process.kill(pid, 'SIGKILL'); }
    catch (killError) {
      // The command can reach its server deadline before the signal arrives.
      if (killError instanceof NotFoundError) { /* Already gone. */ }
      else if (killError instanceof LizardError && killError.status === 400) {
        const stillRunning = (await sandbox.process.list()).some(item => item.pid === pid);
        if (stillRunning) throw killError;
      } else throw killError;
    }
    result = { stdout: stdout.output(), stderr: stderr.output(), exitCode: 124 };
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: Date.now() - started,
  };
}

function status(info: SandboxInfo): InstanceInfo['status'] {
  if (info.status === 'running') return 'running';
  if (['paused', 'pausing', 'stopped', 'deleted', 'killed', 'expired'].includes(info.status ?? '')) return 'stopped';
  return 'error';
}

function snapshotInfo(snapshot: SandboxSnapshot) {
  return {
    id: snapshot.id,
    provider: 'lizard',
    createdAt: new Date(snapshot.createdAt),
    metadata: { name: snapshot.name, status: snapshot.status, sourceSandboxId: snapshot.sourceSandboxId },
  };
}

const createLizard = defineProvider<Sandbox, LizardConfig>({
  name: 'lizard',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const auth = connection(config);
        const project = projectId(config);
        const timeoutMs = lifetime(options.timeout ?? config.timeout ?? 300000);
        const template = options.templateId ?? config.template ?? 'interpreter';
        const sandbox = await Sandbox.create(template, {
          ...auth,
          projectId: project,
          timeoutMs,
          size: size(options.size ?? config.size),
          region: config.region,
          snapshotId: options.snapshotId,
          envs: options.envs,
          metadata: metadata(options.metadata),
        });
        return { instance: sandbox, instanceId: sandbox.sandboxId };
      },
      getById: async (config, id) => {
        try {
          const sandbox = await Sandbox.connect(id, connection(config));
          return { instance: sandbox, instanceId: sandbox.sandboxId };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },
      list: async (config) => {
        const auth = connection(config);
        const sandboxes = await Sandbox.list({ ...auth, projectId: projectId(config) });
        return sandboxes.map(info => ({
          instance: new Sandbox({ sandboxId: info.sandboxId, ...auth }),
          instanceId: info.sandboxId,
        }));
      },
      destroy: async (config, id) => {
        await new Sandbox({ sandboxId: id, ...connection(config) }).kill();
      },
      runCommand,
      streamCommand: runCommand,
      getInfo: async (sandbox): Promise<InstanceInfo> => {
        const info = await sandbox.getInfo();
        const start = Date.parse(info.startedAt);
        const end = Date.parse(info.endAt);
        return {
          id: sandbox.sandboxId,
          provider: 'lizard',
          status: status(info),
          createdAt: new Date(info.startedAt),
          timeout: Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, end - start) : 0,
          metadata: {
            ...info.metadata,
            template: info.template,
            region: info.region,
            runtime: info.runtime,
            size: info.size,
            nativeStatus: info.status,
          },
        };
      },
      getUrl: async (sandbox, { port, protocol = 'https' }) => {
        if (protocol !== 'https') throw new Error('Lizard port URLs support HTTPS; use getInstance().exposePort() for the access token and hostname.');
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 through 65535.');
        return (await sandbox.exposePort(port)).url;
      },
      getInstance: sandbox => sandbox,
      filesystem: {
        readFile: (sandbox, path) => sandbox.fs.read(path),
        writeFile: (sandbox, path, content) => sandbox.fs.write(path, content),
        mkdir: (sandbox, path) => sandbox.fs.makeDir(path),
        readdir: async (sandbox, path) => (await sandbox.fs.list(path)).map(entry => ({
          name: entry.name,
          type: entry.type === 'dir' ? 'directory' as const : 'file' as const,
          size: entry.size,
          modified: entry.modTime === undefined ? undefined : new Date(entry.modTime),
        })),
        exists: async (sandbox, path) => {
          try { await sandbox.fs.stat(path); return true; }
          catch (error) {
            if (!(error instanceof NotFoundError)) throw error;
            await sandbox.getInfo();
            return false;
          }
        },
        remove: (sandbox, path) => sandbox.fs.remove(path),
      },
    },
    snapshot: {
      create: async (config, id, options) => {
        if (options?.metadata && Object.keys(options.metadata).length) throw new Error('Lizard snapshots do not support custom metadata.');
        const sandbox = await Sandbox.connect(id, connection(config));
        return snapshotInfo(await sandbox.snapshot(options?.name, { scope: 'project' }));
      },
      list: async (config, options) => {
        const items = await Sandbox.snapshots(projectId(config), connection(config));
        const id = options?.instanceId ?? options?.sandboxId;
        const filtered = id ? items.filter(item => item.sourceSandboxId === id) : items;
        return (options?.limit === undefined ? filtered : filtered.slice(0, options.limit)).map(snapshotInfo);
      },
      delete: (config, id) => Sandbox.deleteSnapshot(id, connection(config)),
    },
  },
});

export const lizard = (config: LizardConfig = {}) => createLizard(config);

export type { Sandbox as LizardSandbox } from '@lizard-build/sdk';

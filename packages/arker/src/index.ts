/**
 * Arker Provider - Factory-based Implementation
 *
 * Arker (https://arker.ai) runs sandboxed VMs with persistent per-VM
 * filesystems.
 */

import { Arker, ArkerError, VM } from '@arker-ai/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { ForkOptions, RunOptions } from '@arker-ai/sdk';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/** Region used when none is configured. */
const DEFAULT_REGION = 'aws-us-east-1';
/** Golden forked when none is requested — small Ubuntu VM with node + python. */
const DEFAULT_SOURCE = 'ubuntu-small';

export interface ArkerConfig {
  /** Arker API key (starts with `ark_`). Falls back to the ARKER_API_KEY environment variable. */
  apiKey?: string;
  /** Region, e.g. `aws-us-east-1`. Falls back to ARKER_REGION, then the us-east-1 default. */
  region?: string;
  /** Golden source VM to fork on create(). Falls back to ARKER_SOURCE, then `ubuntu-small`. */
  source?: string;
}

const env = (key: string): string | undefined => {
  const value = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return value && value.trim() ? value.trim() : undefined;
};

/**
 * Build an Arker SDK client. Region precedence: config, then ARKER_REGION,
 * then the us-east-1 default — the SDK itself requires a region, so an
 * unconfigured caller gets a working default instead of a thrown error.
 */
function makeClient(config: ArkerConfig): Arker {
  return new Arker({
    apiKey: config.apiKey,
    region: config.region ?? env('ARKER_REGION') ?? DEFAULT_REGION,
  });
}

const decoder = new TextDecoder();

/** Single-quote a string for `sh -c`, escaping any embedded single quotes. */
const singleQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Decode a run-status output field per its declared encoding. */
const decodeOutput = (value: string, encoding: string): string =>
  encoding === 'base64' ? Buffer.from(value, 'base64').toString('utf8') : value;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A run that outlives its synchronous window (default 30s) converts to a
 * background run; poll it to completion. The platform imposes no inner
 * timeout on the command itself, so an unbounded command is the caller's.
 */
async function pollRunToCompletion(sandbox: VM, runId: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let delayMs = 500;
  for (;;) {
    const run = await sandbox.getRun(runId);
    if (run.state === 'completed') {
      if (run.exit_code == null) throw new Error(`Arker run ${runId} completed without an exit code.`);
      return {
        stdout: decodeOutput(run.stdout, run.stdout_encoding),
        stderr: decodeOutput(run.stderr, run.stderr_encoding),
        exitCode: run.exit_code,
      };
    }
    if (run.state === 'failed') throw new Error(`Arker run ${runId} failed: ${run.fail_reason ?? 'unknown reason'}`);
    if (run.state === 'cancelled') throw new Error(`Arker run ${runId} was cancelled.`);
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 2000);
  }
}

export const arker = defineProvider<VM, ArkerConfig>({
  name: 'arker',
  methods: {
    sandbox: {
      // --- Collection operations ---

      create: async (config: ArkerConfig, options?: CreateSandboxOptions) => {
        const client = makeClient(config);
        const source = options?.templateId || options?.snapshotId || config.source || env('ARKER_SOURCE') || DEFAULT_SOURCE;

        const forkOpts: Partial<ForkOptions> = {};
        if (options?.name) forkOpts.name = options.name;

        const vm = await client.fork(source, forkOpts);
        return { sandbox: vm, sandboxId: vm.id };
      },

      getById: async (config: ArkerConfig, sandboxId: string) => {
        const client = makeClient(config);
        try {
          const vm = await client.getVm(sandboxId);
          return { sandbox: vm, sandboxId };
        } catch (err) {
          if (err instanceof ArkerError && err.status === 404) return null;
          throw err;
        }
      },

      list: async (config: ArkerConfig) => {
        const client = makeClient(config);
        const { vms } = await client.listVms();
        return vms.map((vm) => ({ sandbox: vm, sandboxId: vm.id }));
      },

      destroy: async (config: ArkerConfig, sandboxId: string) => {
        const client = makeClient(config);
        try {
          await client.vm(sandboxId).delete();
        } catch (err) {
          if (err instanceof ArkerError && err.status === 404) return;
          throw err;
        }
      },

      // --- Instance operations ---

      runCommand: async (sandbox: VM, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const assignments = Object.entries(options.env)
            .map(([k, v]) => {
              // A shell `NAME=value` prefix can't quote the name, so reject any
              // name that isn't a valid identifier.
              if (!/^[A-Za-z_]\w*$/.test(k)) {
                throw new Error(`Arker runCommand: invalid environment variable name: ${JSON.stringify(k)}`);
              }
              return `${k}="${escapeShellArg(String(v))}"`;
            })
            .join(' ');
          fullCommand = `${assignments} ${fullCommand}`;
        }
        if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        // Wrap in `sh -c` so any cwd/env prefix detaches with the command;
        // a bare `nohup cd … && …` would run only `cd` under nohup.
        if (options?.background) fullCommand = `nohup sh -c ${singleQuote(fullCommand)} > /dev/null 2>&1 &`;

        const runOptions: RunOptions = {};
        if (options?.timeout) runOptions.timeout = options.timeout;

        const result = await sandbox.run(fullCommand, runOptions);
        if (result.type === 'completed') {
          return {
            stdout: decoder.decode(result.stdout),
            stderr: decoder.decode(result.stderr),
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        }
        // The run outlived its synchronous window and converted to background.
        // With an explicit timeout the window *was* the caller's deadline —
        // cancel and report the timeout; otherwise poll to completion.
        if (options?.timeout) {
          await sandbox.cancelRun(result.runId).catch(() => {});
          throw new Error(`Arker command timed out after ${options.timeout}ms and was cancelled (run ${result.runId}).`);
        }
        const polled = await pollRunToCompletion(sandbox, result.runId);
        return { ...polled, durationMs: Date.now() - startTime };
      },

      getInfo: async (sandbox: VM): Promise<SandboxInfo> => ({
        id: sandbox.id,
        provider: 'arker',
        status: 'running',
        createdAt: sandbox.created_at ? new Date(sandbox.created_at) : new Date(),
        timeout: 0,
      }),

      getUrl: async (_sandbox: VM, options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(
          `Arker does not expose per-port URLs (requested port ${options.port}). ` +
            `VMs forked with network reachability enabled get a stable per-VM hostname ` +
            `(see the @arker-ai/sdk fork network options and vm.network.hostname).`
        );
      },

      getInstance: (sandbox: VM): VM => sandbox,

      // --- Filesystem (over runCommand; works anywhere in the VM) ---

      filesystem: {
        readFile: async (sandbox, path, runCommand): Promise<string> => {
          const result = await runCommand(sandbox, `cat "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Arker readFile failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`);
          return result.stdout;
        },
        writeFile: async (sandbox, path, content, runCommand): Promise<void> => {
          // base64 round-trip so arbitrary content needs no shell escaping
          const b64 = Buffer.from(content, 'utf8').toString('base64');
          const result = await runCommand(sandbox, `printf '%s' "${b64}" | base64 -d > "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Arker writeFile failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`);
        },
        mkdir: async (sandbox, path, runCommand): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Arker mkdir failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`);
        },
        readdir: async (sandbox, path, runCommand): Promise<FileEntry[]> => {
          const result = await runCommand(sandbox, `ls -la "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Arker readdir failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`);

          const entries: FileEntry[] = [];
          for (const line of result.stdout.split('\n')) {
            const parts = line.trim().split(/\s+/);
            // Skip the "total" line, malformed rows, and . / ..
            if (parts.length < 9 || !/^[-dl]/.test(parts[0])) continue;
            let name = parts.slice(8).join(' ');
            if (parts[0].startsWith('l')) name = name.split(' -> ')[0]; // symlink arrow
            if (name === '.' || name === '..') continue;
            // ls prints "Mmm dd HH:MM" for recent files (no year) and "Mmm dd YYYY" otherwise.
            const [month, day, timeOrYear] = parts.slice(5, 8);
            const dateStr = timeOrYear.includes(':')
              ? `${month} ${day} ${new Date().getFullYear()} ${timeOrYear}`
              : `${month} ${day} ${timeOrYear}`;
            const modified = new Date(dateStr);
            entries.push({
              name,
              type: parts[0].startsWith('d') ? 'directory' : 'file',
              size: Number(parts[4]) || 0,
              modified: isNaN(modified.getTime()) ? new Date(0) : modified,
            });
          }
          return entries;
        },
        exists: async (sandbox, path, runCommand): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },
        remove: async (sandbox, path, runCommand): Promise<void> => {
          const result = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Arker remove failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`);
        },
      },
    },
  },
});

export type { VM as ArkerSandbox } from '@arker-ai/sdk';

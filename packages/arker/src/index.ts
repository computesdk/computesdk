/**
 * Arker Provider - Factory-based Implementation
 *
 * Arker (https://arker.ai) runs sandboxed VMs with persistent per-VM
 * filesystems.
 */

import { Arker, ArkerError, VM } from '@arker-ai/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { RunOptions } from '@arker-ai/sdk';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/** Provider used when none is configured. */
const DEFAULT_PROVIDER = 'aws';
/** Region used when none is configured. */
const DEFAULT_REGION = 'us-east-1';
/** Golden forked when none is requested — small Ubuntu VM with node + python. */
const DEFAULT_SOURCE = 'ubuntu-small';

export interface ArkerConfig {
  /** Arker API key (starts with `ark_`). Falls back to the ARKER_API_KEY environment variable. */
  apiKey?: string;
  /** Region, e.g. `us-east-1`. Falls back to ARKER_REGION, then the us-east-1 default.
   *  A combined `"<provider>-<region>"` value (e.g. `aws-us-east-1`) is still accepted. */
  region?: string;
  /** Compute provider, e.g. `aws`. Falls back to ARKER_PROVIDER, then `aws`.
   *  The SDK requires provider and region together. */
  provider?: string;
  /** Golden source VM to fork on create(). Falls back to ARKER_SOURCE, then `ubuntu-small`. */
  source?: string;
  /** Compute platforms to fork onto, e.g. `['graviton4']`. Falls back to ARKER_PLATFORMS (comma-separated). */
  platforms?: string[];
}

const env = (key: string): string | undefined => {
  const value = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return value && value.trim() ? value.trim() : undefined;
};

/** Known compute providers, used to split a combined `<provider>-<region>` value. */
const PROVIDER_PREFIXES = ['aws', 'gcp', 'azure', 'arker'] as const;

/**
 * Split a region that still carries a provider prefix (`aws-us-east-1`) into
 * its parts. Returns `[undefined, region]` when there is no prefix.
 */
function splitPlacement(region: string): [string | undefined, string] {
  for (const p of PROVIDER_PREFIXES) {
    if (region.startsWith(`${p}-`)) return [p, region.slice(p.length + 1)];
  }
  return [undefined, region];
}

/**
 * Build an Arker SDK client. The SDK requires `provider` and `region`
 * together, so both always resolve to a value: config, then env
 * (ARKER_PROVIDER / ARKER_REGION), then the aws/us-east-1 default. A
 * combined `aws-us-east-1` region is split so older callers keep working.
 */
function makeClient(config: ArkerConfig): Arker {
  const rawRegion = config.region ?? env('ARKER_REGION') ?? DEFAULT_REGION;
  const [prefixed, region] = splitPlacement(rawRegion);
  const provider = config.provider ?? env('ARKER_PROVIDER') ?? prefixed ?? DEFAULT_PROVIDER;
  return new Arker({
    apiKey: config.apiKey ?? env('ARKER_API_KEY'),
    provider,
    region,
  });
}

/** Single-quote a string for `sh -c`, escaping any embedded single quotes. */
const singleQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Reject once `ms` elapses, so a caller's timeout is a real deadline. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Arker command timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
    // The losing run keeps going until its server-side kill bound; swallow its
    // outcome so it cannot surface as an unhandled rejection.
    promise.catch(() => {});
  }
}

export const arker = defineProvider<VM, ArkerConfig>({
  name: 'arker',
  methods: {
    sandbox: {
      // --- Collection operations ---

      create: async (config: ArkerConfig, options?: CreateSandboxOptions) => {
        const client = makeClient(config);
        const name = options?.name ?? null;
        
        const platforms =
          config.platforms ??
          env('ARKER_PLATFORMS')?.split(',').map((p) => p.trim()).filter(Boolean);

        // SDK 1.x takes a single options object keyed by the wire schema
        // (`source_vm_id` / `source_vm_name`); the old `fork(name, opts)`
        // overload is gone.
        const vm = options?.snapshotId
          ? await client.fork({ source_vm_id: options.snapshotId, name })
          : await client.fork({
              source_vm_name:
                options?.templateId || config.source || env('ARKER_SOURCE') || DEFAULT_SOURCE,
              name,
              ...(platforms?.length ? { platforms } : {}),
            });

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

        // Leaving `time_to_background` unset selects the SDK's synchronous
        // overload: the SDK polls the run to completion itself and resolves
        // `CompletedRunResult`, so there is nothing to poll or narrow here.
        const runOptions: Omit<RunOptions, 'time_to_background'> = {};
        // ComputeSDK's timeout is milliseconds; Arker's is seconds (rounded up so a
        // sub-second timeout stays non-zero — 0 means "no limit" to Arker).
        if (options?.timeout) runOptions.timeout = Math.max(1, Math.ceil(options.timeout / 1000));

        const run = sandbox.run(fullCommand, runOptions);
        // The run's `timeout` is a server-side kill bound, so an over-running command
        // comes back as a completed run with a non-zero exit code rather than a
        // rejection. RunCommandOptions.timeout is documented as a deadline, so reject
        // once it passes; the kill bound above stops the command server-side.
        const result = options?.timeout ? await withDeadline(run, options.timeout) : await run;
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startTime,
        };
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

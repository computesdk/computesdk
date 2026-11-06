/**
 * Arker Provider - Factory-based Implementation
 *
 * Arker (https://arker.ai) runs sandboxed VMs with persistent per-VM
 * filesystems.
 */

import { Arker, ArkerError, VM } from '@arker-ai/sdk';
import { defineProvider, escapeShellArg, InstanceSizeError } from '@computesdk/provider';

import type { PatchVmRequest, PolicyDoc, PolicyEntry, ResourcesInput, RunOptions } from '@arker-ai/sdk';
import type {
  CommandResult,
  InstanceInfo,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  FileEntry,
  ListSnapshotsOptions,
  RunCommandOptions,
} from '@computesdk/provider';

/** Provider used when none is configured. */
const DEFAULT_PROVIDER = 'aws';
/** Region used when none is configured. */
const DEFAULT_REGION = 'us-east-1';
/** Golden forked when none is requested — small Ubuntu VM with node + python. */
const DEFAULT_SOURCE = 'ubuntu-small';

/**
 * Catalog bounds of public ArkerHQ goldens (https://arker.ai/docs/vms). A fork
 * takes `resources` per create, but only within its source VM's bounds.
 */
const GOLDEN_BOUNDS: Record<string, { maxVcpus: number; minMemoryMiB: number; maxMemoryMiB: number }> = {
  'ubuntu-coding': { maxVcpus: 4, minMemoryMiB: 1024, maxMemoryMiB: 15360 },
  'ubuntu-coding-8': { maxVcpus: 8, minMemoryMiB: 2560, maxMemoryMiB: 16384 },
  'ubuntu-coding-32': { maxVcpus: 32, minMemoryMiB: 2560, maxMemoryMiB: 32768 },
  'ubuntu-full-8': { maxVcpus: 8, minMemoryMiB: 2560, maxMemoryMiB: 16384 },
};
/** Same-toolchain goldens a sized create forks from when no source is pinned, smallest first. */
const SIZED_SOURCES = ['ubuntu-coding', 'ubuntu-coding-8', 'ubuntu-coding-32'];

const fitsGolden = (name: string, vcpus: number, memoryMiB: number): boolean => {
  const b = GOLDEN_BOUNDS[name];
  return !!b && vcpus <= b.maxVcpus && memoryMiB >= b.minMemoryMiB && memoryMiB <= b.maxMemoryMiB;
};

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

/** Raw bytes per file-transfer command (a multiple of 3, ~1 MiB of base64). */
const WRITE_CHUNK_BYTES = 3 * 256 * 1024;

/** Name prefix marking VMs forked by `snapshot.create`. */
const SNAPSHOT_PREFIX = 'computesdk-snapshot-';

export interface ArkerSnapshot {
  /** ID of the forked VM; pass it as `snapshotId` to restore. */
  id: string;
  provider: 'arker';
  createdAt: Date;
  metadata?: Record<string, any>;
}

/** Id of the schedule rule `pause` writes to suspend a VM. */
const PAUSE_RULE = 'computesdk-pause';
/** How long `pause` waits for the suspend to take effect. */
const PAUSE_TIMEOUT_MS = 60_000;

/**
 * Write (or, with `null`, remove) one policy rule by id, keeping the others.
 * The id-keyed `rules` form of `PATCH /v1/vms/{id}` postdates the SDK's
 * `PatchVmRequest` type, which still describes the deprecated list form.
 */
const patchRule = (vm: VM, id: string, rule: Record<string, unknown> | null) =>
  vm.update({ policies: { rules: { [id]: rule } } } as unknown as PatchVmRequest);

const isNotFound = (err: unknown): boolean => err instanceof ArkerError && err.status === 404;

/** True when an inbound rule already serves `port`. */
const exposesPort = (rule: PolicyEntry, port: number): boolean =>
  rule.type === 'inbound' && rule.action !== 'deny' && !!rule.match?.ports?.includes(port);

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
  // Arker sizes per fork with `resources`, bounded by the source VM. Unpinned
  // creates fork the smallest ubuntu-coding golden that holds the shape.
  sizes: (config, profile, options) => {
    // The SDK already rejects sizeClass combined with native `resources`.
    const { vcpus, memoryMiB } = profile;
    const sized = { resources: { vcpu: vcpus, memory_mib: memoryMiB } };
    if (options?.snapshotId) {
      return { status: 'unknown', reason: 'A snapshot fork keeps its source VM\'s resource bounds, which this adapter has not verified.' };
    }
    const pinned = options?.templateId || config.source || env('ARKER_SOURCE');
    if (pinned) {
      if (GOLDEN_BOUNDS[pinned] && !fitsGolden(pinned, vcpus, memoryMiB)) {
        const b = GOLDEN_BOUNDS[pinned];
        return { status: 'unsupported', reason: `Arker golden ${pinned} forks at 1-${b.maxVcpus} vCPU / ${b.minMemoryMiB}-${b.maxMemoryMiB} MiB, not ${vcpus} vCPU / ${memoryMiB} MiB.` };
      }
      return { status: 'supported', nativeOptions: sized };
    }
    const golden = SIZED_SOURCES.find((g) => fitsGolden(g, vcpus, memoryMiB));
    if (!golden) {
      return { status: 'unsupported', reason: `No public Arker golden forks at ${vcpus} vCPU / ${memoryMiB} MiB.` };
    }
    return { status: 'supported', nativeOptions: { templateId: golden, ...sized } };
  },
  methods: {
    instances: {
      // --- Collection operations ---

      create: async (config: ArkerConfig, options?: CreateInstanceOptions) => {
        const client = makeClient(config);
        const name = options?.name ?? null;
        
        const platforms =
          config.platforms ??
          env('ARKER_PLATFORMS')?.split(',').map((p) => p.trim()).filter(Boolean);
        const resources = options?.resources as ResourcesInput | undefined;
        const source = options?.templateId || config.source || env('ARKER_SOURCE') || DEFAULT_SOURCE;

        // SDK 1.x takes a single options object keyed by the wire schema
        // (`source_vm_id` / `source_vm_name`); the old `fork(name, opts)`
        // overload is gone.
        let vm: VM;
        try {
          vm = options?.snapshotId
            ? await client.fork({ source_vm_id: options.snapshotId, name, ...(resources ? { resources } : {}) })
            : await client.fork({
                source_vm_name: source,
                name,
                ...(platforms?.length ? { platforms } : {}),
                ...(resources ? { resources } : {}),
              });
        } catch (err) {
          // The source VM bounds the resources a fork can take; Arker enforces them.
          if (resources && err instanceof ArkerError && (err.status === 400 || err.status === 422) &&
              /vcpu|memory|resource/i.test(err.message)) {
            throw new InstanceSizeError(
              'unsupported',
              `Arker cannot fork ${options?.snapshotId ?? source} at ${JSON.stringify(resources)}: ${err.message}`,
            );
          }
          throw err;
        }

        return { instance: vm, instanceId: vm.id };
      },

      getById: async (config: ArkerConfig, sandboxId: string) => {
        const client = makeClient(config);
        try {
          const vm = await client.getVm(sandboxId);
          return { instance: vm, instanceId: sandboxId };
        } catch (err) {
          if (err instanceof ArkerError && err.status === 404) return null;
          throw err;
        }
      },

      list: async (config: ArkerConfig) => {
        const client = makeClient(config);
        const { vms } = await client.listVms();
        return vms.map((vm) => ({ instance: vm, instanceId: vm.id }));
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
        if (options?.cwd) fullCommand = `cd ${singleQuote(options.cwd)} && { ${fullCommand}\n}`;
        if (options?.env && Object.keys(options.env).length > 0) {
          const assignments = Object.entries(options.env)
            .map(([k, v]) => {
              // `export NAME=value` can't quote the name, so reject any name
              // that isn't a valid identifier.
              if (!/^[A-Za-z_]\w*$/.test(k)) {
                throw new Error(`Arker runCommand: invalid environment variable name: ${JSON.stringify(k)}`);
              }
              return `${k}=${singleQuote(String(v))}`;
            })
            .join(' ');
          // `export` (not a `NAME=value cmd` prefix) so every part of a compound
          // command sees the variables.
          fullCommand = `export ${assignments}; ${fullCommand}`;
        }
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

      getInfo: async (sandbox: VM): Promise<InstanceInfo> => ({
        id: sandbox.id,
        provider: 'arker',
        status: 'running',
        createdAt: sandbox.created_at ? new Date(sandbox.created_at) : new Date(),
        timeout: 0,
      }),

      // Arker serves a guest port once an inbound policy rule allows it, at
      // `<vm>-<port>.<provider>-<region>.arker.app`. Add a public (`auth: open`)
      // rule for the port, keeping the VM's other rules, and derive the URL from
      // the hostname the policy endpoint returns.
      getUrl: async (sandbox: VM, options: { port: number; protocol?: string }): Promise<string> => {
        const { port } = options;
        const current = await sandbox.getPolicies();
        const rules = current.policies ?? [];
        let doc: PolicyDoc = current;
        if (!rules.some((rule) => exposesPort(rule, port))) {
          const rule: PolicyEntry = { type: 'inbound', match: { ports: [port] }, action: 'allow', auth: 'open' };
          doc = await sandbox.setPolicies({ policies: [...rules, rule], ...(current.secrets ? { secrets: current.secrets } : {}) });
        }
        const base = doc.hostname ?? current.hostname;
        if (!base) throw new Error(`Arker did not return an inbound hostname for VM ${sandbox.id}`);
        const dot = base.indexOf('.');
        const host = `${base.slice(0, dot)}-${port}${base.slice(dot)}`;
        const protocol = options.protocol ?? 'https';
        return `${protocol}://${host}`;
      },

      getInstance: (sandbox: VM): VM => sandbox,

      // An idle Arker VM is already frozen; pause suspends a running one too
      // (in-flight runs go `pending`) with a `schedule` rule whose `at` has
      // passed, which fires at once. The rule is removed once the VM is idle so
      // it can't outlive the pause. Memory is kept: processes and in-flight
      // runs carry on when the VM next starts.
      pause: async (sandbox: VM): Promise<void> => {
        await patchRule(sandbox, PAUSE_RULE, {
          type: 'schedule',
          at: new Date(Date.now() - 1000).toISOString(),
          action: 'suspend',
        });
        try {
          const deadline = Date.now() + PAUSE_TIMEOUT_MS;
          while ((await sandbox.refresh()).state !== 'idle') {
            if (Date.now() > deadline) throw new Error(`Arker VM ${sandbox.id} did not suspend within ${PAUSE_TIMEOUT_MS}ms`);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } finally {
          await patchRule(sandbox, PAUSE_RULE, null);
        }
      },

      // Any run starts a suspended VM, and its pending runs resume with it.
      resume: async (sandbox: VM): Promise<void> => {
        const result = await sandbox.run('true');
        if (result.exitCode !== 0) throw new Error(`Arker resume failed for VM ${sandbox.id}: exit ${result.exitCode}`);
      },
      pauseCapabilities: { memory: true },

      // --- Filesystem: file bodies over Arker's native sync API, the rest over runCommand ---

      filesystem: {
        // Native sync read; large files whose presigned read fails fall back
        // to base64 chunks over runCommand.
        readFile: async (sandbox, path, runCommand): Promise<string> => {
          const fail = (detail: string) => new Error(`Arker readFile failed for ${path}: ${detail}`);
          if (path.startsWith('/')) {
            try {
              return new TextDecoder().decode(await sandbox.sync(path));
            } catch (err) {
              if (!(err instanceof ArkerError) || err.status === 404) {
                throw fail(err instanceof Error ? err.message : String(err));
              }
            }
          }
          const target = singleQuote(path);
          const stat = await runCommand(sandbox, `wc -c < ${target}`);
          if (stat.exitCode !== 0) throw fail(stat.stderr || `exit ${stat.exitCode}`);
          const size = Number(stat.stdout.trim());
          const chunks: Buffer[] = [];
          for (let start = 0; start < size; start += WRITE_CHUNK_BYTES) {
            const result = await runCommand(
              sandbox,
              `tail -c +${start + 1} ${target} | head -c ${WRITE_CHUNK_BYTES} | base64 | tr -d '\\n'`
            );
            if (result.exitCode !== 0) throw fail(result.stderr || `exit ${result.exitCode}`);
            chunks.push(Buffer.from(result.stdout.trim(), 'base64'));
          }
          return Buffer.concat(chunks).toString('utf8');
        },
        // Arker's sync write op answers `not_found` for every write, so file
        // bodies go over runCommand: base64 chunks appended to a temp file,
        // then moved into place. Chunks are a multiple of 3 bytes so each
        // decodes on its own.
        writeFile: async (sandbox, path, content, runCommand): Promise<void> => {
          const bytes = Buffer.from(content, 'utf8');
          const target = singleQuote(path);
          const tmp = singleQuote(`${path}.csdk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
          const fail = (stderr: string, exitCode: number) =>
            new Error(`Arker writeFile failed for ${path}: ${stderr || `exit ${exitCode}`}`);
          if (bytes.length <= WRITE_CHUNK_BYTES) {
            const result = await runCommand(sandbox, `printf '%s' '${bytes.toString('base64')}' | base64 -d > ${target}`);
            if (result.exitCode !== 0) throw fail(result.stderr, result.exitCode);
            return;
          }
          try {
            for (let start = 0; start < bytes.length; start += WRITE_CHUNK_BYTES) {
              const chunk = bytes.subarray(start, start + WRITE_CHUNK_BYTES).toString('base64');
              const result = await runCommand(sandbox, `printf '%s' '${chunk}' | base64 -d ${start === 0 ? '>' : '>>'} ${tmp}`);
              if (result.exitCode !== 0) throw fail(result.stderr, result.exitCode);
            }
            const result = await runCommand(sandbox, `mv -f ${tmp} ${target}`);
            if (result.exitCode !== 0) throw fail(result.stderr, result.exitCode);
          } catch (err) {
            await runCommand(sandbox, `rm -f ${tmp}`).catch(() => {});
            throw err;
          }
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

    // A snapshot is a warm fork of the VM (disk + memory). Restore by passing
    // its id as `snapshotId` to create(), which forks from it again.
    snapshot: {
      // The whole root disk (including /tmp, which is not a tmpfs) and running
      // processes; the source keeps running.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },

      create: async (config: ArkerConfig, instanceId: string, options?: CreateSnapshotOptions): Promise<ArkerSnapshot> => {
        const client = makeClient(config);
        const name = `${SNAPSHOT_PREFIX}${options?.name ? `${options.name}-` : ''}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const vm = await client.vm(instanceId).fork({ name, description: `snapshot of ${instanceId}` });
        return {
          id: vm.id,
          provider: 'arker',
          createdAt: vm.created_at ? new Date(vm.created_at) : new Date(),
          metadata: { name: vm.name ?? name, sourceInstanceId: instanceId, ...options?.metadata },
        };
      },

      // Arker's VM listing omits names and caps its pages, so snapshot forks
      // can't be told apart from other VMs; keep the ids create() returns.
      list: async (_config: ArkerConfig, _options?: ListSnapshotsOptions): Promise<ArkerSnapshot[]> => {
        throw new Error('Arker cannot list snapshots: its VM listing does not identify snapshot forks');
      },

      delete: async (config: ArkerConfig, snapshotId: string): Promise<void> => {
        const client = makeClient(config);
        try {
          await client.vm(snapshotId).delete();
        } catch (err) {
          if (isNotFound(err)) return;
          throw err;
        }
      },
    },
  },
});

export type { VM as ArkerSandbox } from '@arker-ai/sdk';

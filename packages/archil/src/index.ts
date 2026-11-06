/**
 * Archil Provider
 *
 * Archil sandboxes are persistent Linux VMs (Firecracker, durable root
 * filesystem), and that is what this provider creates by default. Commands,
 * streaming and background processes run through Archil's native process API
 * (a WebSocket fetched fresh per process via POST
 * /api/sandboxes/{id}/connections); files move through its native file
 * transfer API; snapshots are paused forks restored with create({ snapshotId }).
 *
 * The older disk exec surface — each command runs in a fresh Archil-managed
 * container with a disk mounted at /mnt/archil — is opt-in with
 * `execution: "exec"` (or ARCHIL_EXECUTION=exec) plus a disk id.
 */

import { defineProvider, InstanceSizeError } from '@computesdk/provider';
import { Archil as ArchilClient, ArchilError } from 'disk';
import type {
  CreateSandboxRequest as ArchilSandboxRequest,
  Sandbox as ArchilVm,
  SandboxProcessResult,
} from 'disk';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type {
  CommandResult,
  InstanceInfo,
  CreateInstanceOptions,
  FileEntry,
  ProcessHandle,
  RunCommandOptions,
  StartProcessOptions,
} from 'computesdk';

const ARCHIL_MOUNT_ROOT = '/mnt/archil';
const ARCHIL_MAX_EXEC_COMMAND_BYTES = 102_400;
// Base64 expands the file data and adds line wrapping. Keep the raw chunk
// comfortably below Archil's roughly 4 MiB response cap.
const ARCHIL_MAX_READ_CHUNK_BYTES = 2 * 1024 * 1024;

// Per-region color overrides. Default is "green" for any region not listed here.
const REGION_COLORS: Record<string, string> = {
  'gcp-us-central1': 'blue',
};

function regionToBaseUrl(region: string): string {
  const dash = region.indexOf('-');
  if (dash <= 0 || dash === region.length - 1) {
    throw new Error(
      `Invalid Archil region "${region}". Expected "{cloud}-{suffix}", e.g. "aws-us-east-1".`,
    );
  }
  const cloud = region.slice(0, dash);
  const suffix = region.slice(dash + 1);
  const color = REGION_COLORS[region] ?? 'green';
  return `https://control.${color}.${suffix}.${cloud}.prod.archil.com`;
}

/**
 * Archil execution mode:
 * - "persistent" (default): a persistent sandbox VM run through the process API.
 * - "exec": serverless per-command containers on an existing disk (opt-in).
 */
export type ArchilExecutionMode = 'exec' | 'persistent';

export interface ArchilConfig {
  /** Archil API key. Falls back to ARCHIL_API_KEY env var. */
  apiKey?: string;
  /** Archil region (e.g. "aws-us-east-1"). Falls back to ARCHIL_REGION env var. */
  region?: string;
  /** Override the control-plane base URL (useful for testing). */
  baseUrl?: string;
  /**
   * Which Archil compute surface to use. Falls back to ARCHIL_EXECUTION, then
   * "persistent": create() provisions a persistent sandbox VM. "exec"
   * resolves create({ diskId }) to a disk exec handle instead. Per-sandbox
   * override: `ephemeral` on create() options (true -> exec handle, false ->
   * persistent VM).
   */
  execution?: ArchilExecutionMode;
}

interface DiskResponse {
  id: string;
  name: string;
  organization: string;
  status: string;
  provider: string;
  region: string;
  createdAt: string;
}

type DiskHandle = Pick<DiskResponse, 'id'>;

interface ExecTiming {
  totalMs: number;
  queueMs: number;
  executeMs: number;
}

interface ExecResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  timing: ExecTiming;
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  execution: ArchilExecutionMode;
}

interface ArchilSandbox {
  client: ArchilClient;
  disk: DiskHandle | DiskResponse;
  /** Set only in "persistent" execution mode. */
  vm?: ArchilVm;
  resolved: ResolvedConfig;
  createdAt: Date;
  /** persistent mode: pause the VM, preserving CPU and memory state. */
  pause?: () => Promise<void>;
  /** persistent mode: resume the paused VM under the same sandbox id. */
  resume?: () => Promise<void>;
}

function vmInstance(
  client: ArchilClient,
  vm: ArchilVm,
  resolved: ResolvedConfig,
): ArchilSandbox {
  return {
    client,
    disk: { id: vm.id },
    vm,
    resolved,
    createdAt: new Date(),
    pause: async () => {
      await vm.pause();
    },
    resume: async () => {
      await vm.resume();
    },
  };
}

interface ArchilCreateOptions extends CreateInstanceOptions {
  /**
   * exec mode: id of the existing disk to run commands against. Required in
   * "exec" mode; ignored in "persistent" mode.
   */
  diskId?: string;
  /** persistent mode: OCI base image (e.g. "node:24-bookworm"). */
  baseImage?: string;
  /** persistent mode: environment variables baked into the sandbox. */
  env?: Record<string, string>;
  /** persistent mode: lifetime budget per powered-on session, in seconds. */
  maxTtlSeconds?: number;
  /** persistent mode: extra Archil sandbox fields (network policy, etc.). */
  sandbox?: Omit<
    ArchilSandboxRequest,
    'name' | 'vcpuCount' | 'memSizeMiB' | 'baseImage' | 'env' | 'maxTtlSeconds'
  >;
}

function resolveConfig(config: ArchilConfig): ResolvedConfig {
  const apiKey = config.apiKey ?? process.env.ARCHIL_API_KEY;
  const region = config.region ?? process.env.ARCHIL_REGION;

  if (!apiKey) {
    throw new Error(
      'Missing API key for Archil.\n\n' +
        'Pass it: archil({ apiKey: "..." })\n' +
        'Or set ARCHIL_API_KEY in your environment.',
    );
  }

  let baseUrl = config.baseUrl;
  if (!baseUrl) {
    if (!region) {
      throw new Error(
        'Missing region for Archil.\n\n' +
          'Pass it: archil({ region: "..." })\n' +
          'Or set ARCHIL_REGION in your environment.\n' +
          'Examples: "aws-us-east-1", "aws-eu-west-1", "gcp-us-central1".',
      );
    }
    baseUrl = regionToBaseUrl(region);
  }

  return { apiKey, baseUrl, execution: resolveExecution(config) };
}

function resolveExecution(config: ArchilConfig): ArchilExecutionMode {
  if (config.execution) return config.execution;
  const fromEnv = process.env.ARCHIL_EXECUTION?.trim().toLowerCase();
  if (!fromEnv) return 'persistent';
  if (fromEnv === 'exec' || fromEnv === 'persistent') return fromEnv;
  throw new Error(
    `Invalid ARCHIL_EXECUTION "${process.env.ARCHIL_EXECUTION}". Expected "persistent" (default) or "exec".`,
  );
}

function createClient(config: ArchilConfig, resolved: ResolvedConfig): ArchilClient {
  const region = config.region ?? process.env.ARCHIL_REGION ?? 'aws-us-east-1';
  return new ArchilClient({ ...resolved, region });
}

function resolveCreateDiskId(options?: ArchilCreateOptions): string {
  // `sandboxId` is accepted as an alias: exec-mode sandboxes are addressed by
  // their disk id.
  const diskId = options?.diskId ?? options?.sandboxId;

  if (!diskId) {
    throw new Error(
      'Archil create() requires an existing disk id on the top-level options.\n\n' +
        'Example:\n' +
        '  provider.sandbox.create({ diskId: "disk_abc123" })',
    );
  }

  return diskId;
}


function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function mapFilesystemPath(sandbox: ArchilSandbox, path: string): string {
  const normalized = posix.normalize(path.startsWith('/') ? path : `/${path}`);

  // In persistent mode the filesystem is the VM's own filesystem.
  if (sandbox.vm) {
    return normalized;
  }

  if (normalized === '/') {
    return ARCHIL_MOUNT_ROOT;
  }

  if (
    normalized === ARCHIL_MOUNT_ROOT ||
    normalized.startsWith(`${ARCHIL_MOUNT_ROOT}/`)
  ) {
    return normalized;
  }

  return `${ARCHIL_MOUNT_ROOT}${normalized}`;
}

function withDiskWriteLockCommand(command: string): string {
  const mountRoot = shellEscape(ARCHIL_MOUNT_ROOT);
  return [
    `archil checkout --force --yes ${mountRoot}`,
    `{ ${command}; status=$?; archil checkin ${mountRoot}; checkin_status=$?; ` +
      `if [ $status -ne 0 ]; then exit $status; fi; exit $checkin_status; }`,
  ].join(' && ');
}

function withDiskWriteLock(sandbox: ArchilSandbox, command: string): string {
  // Sandbox VMs have a dedicated disk — no shared-mode checkout needed.
  if (sandbox.vm) return command;
  return withDiskWriteLockCommand(command);
}

function execCommandBytes(command: string): number {
  return Buffer.byteLength(wrapCommand(command), 'utf8');
}

function buildWriteChunkCommand(
  parent: string,
  tempPath: string,
  diskPath: string,
  encodedChunk: string,
  isFirst: boolean,
  isFinal: boolean,
): string {
  const writeCommand =
    `printf %s ${shellEscape(encodedChunk)} | base64 -d ` +
    `${isFirst ? '>' : '>>'} ${shellEscape(tempPath)}`;
  return [
    ...(isFirst ? [`mkdir -p ${shellEscape(parent)}`] : []),
    writeCommand,
    ...(isFinal
      ? [finalizeStagedFileCommand(tempPath, diskPath)]
      : []),
  ].join(' && ');
}

function finalizeStagedFileCommand(tempPath: string, diskPath: string): string {
  const quotedDestination = shellEscape(diskPath);
  return [
    `if [ -d ${quotedDestination} ]; then`,
    `printf '%s\\n' ${shellEscape(`Refusing to overwrite directory ${diskPath}`)} >&2;`,
    'exit 1;',
    'fi;',
    `mv ${shellEscape(tempPath)} ${quotedDestination}`,
  ].join(' ');
}

function maxWriteChunkSize(
  parent: string,
  tempPath: string,
  diskPath: string,
): number {
  let low = 0;
  let high = ARCHIL_MAX_EXEC_COMMAND_BYTES;

  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const command = withDiskWriteLockCommand(
      buildWriteChunkCommand(
        parent,
        tempPath,
        diskPath,
        'A'.repeat(candidate),
        true,
        true,
      ),
    );

    if (execCommandBytes(command) <= ARCHIL_MAX_EXEC_COMMAND_BYTES) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }

  const chunkSize = low - (low % 4);
  if (chunkSize < 4) {
    throw new Error(
      `Archil filesystem path is too long to write within the ${ARCHIL_MAX_EXEC_COMMAND_BYTES}-byte exec command limit.`,
    );
  }
  return chunkSize;
}

function wrapCommand(command: string, options?: RunCommandOptions): string {
  let wrapped = command;

  if (options?.cwd) {
    wrapped = `cd ${shellEscape(options.cwd)} && ${wrapped}`;
  }

  const envEntries = Object.entries(options?.env ?? {});
  if (!envEntries.some(([key]) => key === 'HOME')) {
    envEntries.unshift(['HOME', process.env.HOME || '/tmp']);
  }
  // `export` instead of a `K=v cmd` prefix: an assignment prefix only binds a
  // simple command, so `K=v (a; b)` or `K=v { a; }` is a shell syntax error.
  const exports = envEntries
    .map(([k, v]) => `${k}=${shellEscape(String(v))}`)
    .join(' ');
  wrapped = `export ${exports}; ${wrapped}`;

  if (options?.background) {
    wrapped = `nohup sh -c ${shellEscape(wrapped)} > /dev/null 2>&1 &`;
  }

  return wrapped;
}

async function execOnDisk(sandbox: ArchilSandbox, command: string): Promise<ExecResponse> {
  return sandbox.client.disks.exec(sandbox.disk.id, command);
}

// Runs the command from `cwd` without regrouping it: Archil hands the command
// string to `/bin/sh -c`, and the newline keeps every part of a compound
// command (`a; b`, `a || b`, pipelines) inside the new working directory. env
// is passed natively to the process, so it reaches every part as well.
function withCwd(command: string, cwd?: string): string {
  return cwd ? `cd ${shellEscape(cwd)} || exit 1\n${command}` : command;
}

async function ensureVmRunning(vm: ArchilVm): Promise<void> {
  // Refresh first: status on this handle is a local snapshot and goes stale
  // when the sandbox is paused/stopped remotely or hits its TTL.
  await vm.refresh();
  if (vm.status === 'running') return;
  if (vm.status === 'paused') {
    await vm.resume();
  } else if (vm.status === 'stopped' || vm.status === 'exited') {
    await vm.start();
  }
}

function requireVm(sandbox: ArchilSandbox, action: 'pause' | 'resume'): ArchilVm {
  if (!sandbox.vm) {
    throw new Error(
      `Archil disk exec handles cannot ${action}; create a persistent VM (ephemeral: false) instead.`,
    );
  }
  return sandbox.vm;
}

// Archil rejects deleting a live sandbox, so stop it first. A sandbox with
// live forks returns 409: forks (snapshots) must be deleted before their parent.
async function stopAndDeleteVm(vm: ArchilVm): Promise<void> {
  if (vm.status === 'deleting' || vm.status === 'deleted') return;
  try {
    if (vm.status !== 'stopped' && vm.status !== 'exited' && vm.status !== 'failed') {
      await vm.stop();
    }
    await vm.delete();
  } catch (error) {
    if (error instanceof ArchilError && error.status === 404) return;
    if (error instanceof ArchilError && error.status === 409) {
      throw new Error(
        `Archil refused to delete sandbox ${vm.id} (409): ${error.message}. ` +
          'Delete its forks and snapshots first; Archil deletes forks before their parent.',
      );
    }
    throw error;
  }
}

function toSandboxRequest(options?: ArchilCreateOptions): ArchilSandboxRequest {
  const request: ArchilSandboxRequest = {
    ...options?.sandbox,
    name: options?.name,
    baseImage: options?.baseImage ?? options?.image ?? options?.templateId,
    env: options?.env ?? options?.envs,
    vcpuCount: options?.vcpus ?? options?.cpu ?? options?.cpus,
    memSizeMiB: options?.memoryMiB ?? options?.memory,
  };
  if (options?.maxTtlSeconds !== undefined) {
    request.maxTtlSeconds = options.maxTtlSeconds;
  } else if (options?.timeout !== undefined) {
    // CreateInstanceOptions.timeout is milliseconds; Archil's TTL is seconds.
    request.maxTtlSeconds = Math.ceil(options.timeout / 1000);
  }
  return request;
}

// Snapshots are paused forks named with this prefix, which is how
// snapshot.list() finds them and instances.list() leaves them out.
const SNAPSHOT_NAME_PREFIX = 'csdk-snap-';

function snapshotName(name?: string): string {
  const suffix = randomUUID().slice(0, 8);
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63 - SNAPSHOT_NAME_PREFIX.length - suffix.length - 1)
    .replace(/-+$/g, '');
  return `${SNAPSHOT_NAME_PREFIX}${slug ? `${slug}-` : ''}${suffix}`;
}

function isSnapshotVm(vm: ArchilVm): boolean {
  return vm.name?.startsWith(SNAPSHOT_NAME_PREFIX) ?? false;
}

// Archil disk ids look like `dsk-…`; sandbox ids are UUIDs.
function isDiskId(id: string): boolean {
  return id.startsWith('dsk-');
}

// Records each handle's effective mode so `destroy` — which only receives an
// id — treats it correctly even when the mode came from a per-sandbox
// `ephemeral` override rather than the provider config.
const sandboxModes = new Map<string, ArchilExecutionMode>();

function modeForId(id: string, resolved: ResolvedConfig): ArchilExecutionMode {
  return sandboxModes.get(id) ?? (isDiskId(id) ? 'exec' : resolved.execution);
}

function diskInstance(
  client: ArchilClient,
  disk: DiskHandle | DiskResponse,
  resolved: ResolvedConfig,
): ArchilSandbox {
  return { client, disk, resolved, createdAt: new Date() };
}

const TIMEOUT_EXIT_CODE = 124;
const KILLED_EXIT_CODE = 137;

interface VmProcessOutcome {
  exitCode: number;
  signal: string | null;
  stderrSuffix: string;
}

function mapProcessResult(
  result: SandboxProcessResult,
  timedOut: boolean,
  killSignal: string | null,
): VmProcessOutcome {
  if (timedOut || result.status === 'timed_out') {
    return { exitCode: TIMEOUT_EXIT_CODE, signal: 'SIGKILL', stderrSuffix: '' };
  }
  if (result.status === 'cancelled') {
    return { exitCode: KILLED_EXIT_CODE, signal: killSignal ?? 'SIGKILL', stderrSuffix: '' };
  }
  if (result.status === 'failed') {
    return {
      exitCode: result.exitCode ?? 1,
      signal: null,
      stderrSuffix: result.exitReason ?? '',
    };
  }
  // Archil reports a process that died from a signal as exit code -1.
  return { exitCode: result.exitCode ?? 0, signal: null, stderrSuffix: '' };
}

/**
 * Starts a process through Archil's native process API with incremental
 * output decoding. The returned `done` promise settles with the mapped result.
 */
async function startVmProcess(
  vm: ArchilVm,
  command: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  },
) {
  await ensureVmRunning(vm);
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const output = { stdout: '', stderr: '' };
  const emit = (stream: 'stdout' | 'stderr', text: string) => {
    if (!text) return;
    output[stream] += text;
    (stream === 'stdout' ? options.onStdout : options.onStderr)?.(text);
  };
  const proc = await vm.processes.start(withCwd(command, options.cwd), {
    env: options.env,
    collectOutput: false,
    timeoutSeconds:
      options.timeout !== undefined ? Math.max(1, Math.ceil(options.timeout / 1000)) : undefined,
    onOutput: (chunk) => emit(chunk.stream, decoders[chunk.stream].decode(chunk.data, { stream: true })),
  });

  const state = { timedOut: false, killSignal: null as string | null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeout !== undefined) {
    // The server-side deadline has one-second granularity; kill at the exact
    // millisecond deadline as well.
    timer = setTimeout(() => {
      state.timedOut = true;
      proc.kill().catch(() => {});
    }, options.timeout);
  }

  const done = proc
    .wait()
    .then((result) => {
      emit('stdout', decoders.stdout.decode());
      emit('stderr', decoders.stderr.decode());
      const mapped = mapProcessResult(result, state.timedOut, state.killSignal);
      return {
        stdout: output.stdout,
        stderr: mapped.stderrSuffix
          ? `${output.stderr}${output.stderr && !output.stderr.endsWith('\n') ? '\n' : ''}${mapped.stderrSuffix}`
          : output.stderr,
        exitCode: mapped.exitCode,
        signal: mapped.signal,
      };
    })
    .catch((error: unknown) => ({
      stdout: output.stdout,
      stderr: `${output.stderr}${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
      signal: null as string | null,
    }))
    .finally(() => {
      if (timer) clearTimeout(timer);
    });

  return { proc, done, state, output };
}

async function runVmCommand(
  vm: ArchilVm,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const startTime = Date.now();
  if (options?.background) {
    // A process started over the native API keeps running after the client
    // disconnects.
    await ensureVmRunning(vm);
    const proc = await vm.processes.start(withCwd(command, options.cwd), {
      env: options.env,
      collectOutput: false,
    });
    await proc.disconnect();
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
  }
  const { done } = await startVmProcess(vm, command, {
    cwd: options?.cwd,
    env: options?.env,
    timeout: options?.timeout,
    onStdout: options?.onStdout,
    onStderr: options?.onStderr,
  });
  const result = await done;
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: Date.now() - startTime,
  };
}

function commandError(error: unknown, startTime: number): CommandResult {
  return {
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: 1,
    durationMs: Date.now() - startTime,
  };
}

function resolveSizingExecution(
  config: ArchilConfig,
  options?: { ephemeral?: boolean },
): ArchilExecutionMode {
  if (options?.ephemeral !== undefined) return options.ephemeral ? 'exec' : 'persistent';
  return resolveExecution(config);
}

const _provider = defineProvider<ArchilSandbox, ArchilConfig>({
  name: 'archil',
  sizes: (config, profile, options) => {
    if (options?.sandbox !== undefined && (options.sandbox === null || typeof options.sandbox !== 'object' || Array.isArray(options.sandbox))) {
      throw new InstanceSizeError('invalid', 'sandbox must be an object when requesting sizeClass');
    }
    if (options?.vcpuCount !== undefined || options?.memSizeMiB !== undefined ||
        options?.vcpu_count !== undefined || options?.mem_size_mib !== undefined ||
        options?.sandbox?.vcpu_count !== undefined || options?.sandbox?.mem_size_mib !== undefined ||
        options?.sandbox?.vcpuCount !== undefined || options?.sandbox?.memSizeMiB !== undefined) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with native Archil CPU/memory fields');
    }
    if (options?.snapshotId !== undefined || options?.sandboxId !== undefined || options?.instanceId !== undefined) {
      return { status: 'unsupported', reason: 'Archil attach/fork does not apply CPU/RAM overrides; create a new persistent VM to request a standard size.' };
    }
    if (resolveSizingExecution(config, options) !== 'persistent') {
      return { status: 'unavailable', reason: 'Archil exec containers do not expose VM sizing. Drop execution: "exec" (persistent VMs are the default) or set ephemeral: false.' };
    }
    if (profile.sizeClass === 'xs' || profile.sizeClass === '2xl') {
      return { status: 'unknown', reason: 'This adapter has not verified this standard shape.' };
    }
    return { status: 'supported', nativeOptions: { vcpus: profile.vcpus, memoryMiB: profile.memoryMiB } };
  },
  methods: {
    instances: {
      create: async (config: ArchilConfig, options?: ArchilCreateOptions) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);

        // `ephemeral` on create() overrides the configured mode for this
        // sandbox: true -> disk exec handle, false -> persistent VM.
        const execution =
          options?.ephemeral !== undefined
            ? options.ephemeral
              ? 'exec'
              : 'persistent'
            : resolved.execution;

        if (options?.snapshotId && execution === 'exec') {
          throw new Error(
            'Archil snapshots fork persistent VMs and cannot be restored in exec mode. Drop execution: "exec" / ephemeral: true.',
          );
        }

        if (execution === 'exec') {
          const diskId = resolveCreateDiskId(options);
          sandboxModes.set(diskId, 'exec');
          return { instance: diskInstance(client, { id: diskId }, resolved), instanceId: diskId };
        }

        if (options?.diskId) {
          throw new Error(
            'Archil create({ diskId }) attaches a disk exec handle, which is opt-in now that persistent VMs are the default.\n\n' +
              'Opt in with archil({ execution: "exec" }) (or ARCHIL_EXECUTION=exec), or pass ephemeral: true.',
          );
        }

        let vm: ArchilVm;
        if (options?.snapshotId) {
          // A snapshot is a paused fork; forking it again yields an independent
          // writable VM resumed from the snapshot's memory and disk state.
          const source = await client.sandboxes.get(options.snapshotId);
          vm = await source.fork({ name: options?.name });
        } else if (options?.sandboxId) {
          // Attach to a live sandbox. Refuse an abort signal here: the
          // sandbox manager destroys a resolved sandbox after an abort,
          // which would delete a sandbox this call did not create.
          if (options?.signal) {
            throw new Error(
              'create({ sandboxId }) attaches to an existing sandbox and cannot be combined with an abort signal',
            );
          }
          vm = await client.sandboxes.get(options.sandboxId);
          await ensureVmRunning(vm);
        } else {
          vm = await client.sandboxes.create(toSandboxRequest(options), {
            wait: true,
          });
        }
        if (vm.status === 'failed') {
          throw new Error(`Archil sandbox ${vm.id} failed to start${vm.exitReason ? `: ${vm.exitReason}` : ''}`);
        }
        sandboxModes.set(vm.id, 'persistent');
        return { instance: vmInstance(client, vm, resolved), instanceId: vm.id };
      },

      getById: async (config: ArchilConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        try {
          if (modeForId(sandboxId, resolved) === 'exec') {
            const disk = await client.disks.get(sandboxId);
            return { instance: diskInstance(client, disk, resolved), instanceId: disk.id };
          }
          const vm = await client.sandboxes.get(sandboxId);
          await ensureVmRunning(vm);
          return { instance: vmInstance(client, vm, resolved), instanceId: vm.id };
        } catch {
          return null;
        }
      },

      // Archil's list endpoints return every sandbox (and the SDK follows disk
      // pagination), so a single call yields the full account listing.
      list: async (config: ArchilConfig) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        if (resolved.execution === 'exec') {
          const disks = await client.disks.list();
          return disks.map((disk) => ({ instance: diskInstance(client, disk, resolved), instanceId: disk.id }));
        }
        const vms = await client.sandboxes.list();
        return vms
          .filter((vm) => !isSnapshotVm(vm) && vm.status !== 'deleting' && vm.status !== 'deleted')
          .map((vm) => ({ instance: vmInstance(client, vm, resolved), instanceId: vm.id }));
      },

      destroy: async (config: ArchilConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        // exec handles are disk references — Archil disks have an independent
        // lifecycle, so destroying them is a no-op.
        const mode = modeForId(sandboxId, resolved);
        sandboxModes.delete(sandboxId);
        if (mode === 'exec') return;
        const client = createClient(config, resolved);
        let vm: ArchilVm;
        try {
          vm = await client.sandboxes.get(sandboxId);
        } catch (error) {
          if (error instanceof ArchilError && (error.status === 404 || error.status === 400)) return;
          throw error;
        }
        await stopAndDeleteVm(vm);
      },

      runCommand: async (
        sandbox: ArchilSandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          if (sandbox.vm) {
            const { onStdout: _out, onStderr: _err, ...rest } = options ?? {};
            return await runVmCommand(sandbox.vm, command, rest);
          }
          const result = await execOnDisk(sandbox, wrapCommand(command, options));
          return {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return commandError(error, startTime);
        }
      },

      // Persistent VMs stream through the process WebSocket. Disk exec only
      // returns output once the command exits, so it is delivered at the end.
      streamCommand: async (
        sandbox: ArchilSandbox,
        command: string,
        options: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          if (sandbox.vm) return await runVmCommand(sandbox.vm, command, options);
          const result = await execOnDisk(sandbox, wrapCommand(command, options));
          if (result.stdout) options.onStdout?.(result.stdout);
          if (result.stderr) options.onStderr?.(result.stderr);
          return {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return commandError(error, startTime);
        }
      },

      startProcess: async (
        sandbox: ArchilSandbox,
        command: string,
        options: StartProcessOptions,
      ): Promise<ProcessHandle> => {
        if (!sandbox.vm) {
          throw new Error(
            'Archil exec mode runs each command in a fresh container, so it cannot host background processes. Use a persistent VM (the default).',
          );
        }
        const startTime = Date.now();
        const { proc, done, state, output } = await startVmProcess(sandbox.vm, command, {
          cwd: options.cwd,
          env: options.env,
          onStdout: options.onStdout,
          onStderr: options.onStderr,
        });
        // Without stdin: true the process sees EOF, as with `< /dev/null`.
        if (!options.stdin) await proc.closeStdin().catch(() => {});

        let exited: (typeof done extends Promise<infer R> ? R : never) | undefined;
        const finished = done.then((result) => {
          exited = result;
          options.onExit?.({ exitCode: result.exitCode, signal: result.signal });
          return result;
        });
        const toResult = (result: Awaited<typeof done>) => ({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: Date.now() - startTime,
        });

        return {
          pid: null,
          jobId: proc.id,
          runtime: 'native',
          write: async (data) => {
            if (!options.stdin) {
              throw new Error('Process was started without stdin: true');
            }
            await proc.sendInput(data);
          },
          closeStdin: async () => {
            if (options.stdin && !exited) await proc.closeStdin();
          },
          status: async () =>
            exited
              ? { status: 'exited', exitCode: exited.exitCode, signal: exited.signal, stdout: exited.stdout, stderr: exited.stderr }
              : { status: 'running', exitCode: null, signal: null, stdout: output.stdout, stderr: output.stderr },
          wait: async (waitOptions) => {
            if (waitOptions?.timeout === undefined) return toResult(await finished);
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Process ${proc.id} did not exit within ${waitOptions.timeout}ms`)),
                waitOptions.timeout,
              );
            });
            try {
              return toResult(await Promise.race([finished, timeout]));
            } finally {
              clearTimeout(timer);
            }
          },
          // Archil's process control only cancels (SIGKILL semantics); the
          // requested signal name is what the result reports.
          kill: async (signal) => {
            if (exited) return;
            state.killSignal = signal ?? 'SIGKILL';
            await proc.kill();
          },
        };
      },

      getInfo: async (sandbox: ArchilSandbox): Promise<InstanceInfo> => {
        if (sandbox.vm) {
          const vm = sandbox.vm;
          return {
            id: vm.id,
            provider: 'archil',
            status:
              vm.status === 'running'
                ? 'running'
                : vm.status === 'failed'
                  ? 'error'
                  : 'stopped',
            createdAt: vm.createdAt,
            timeout: vm.maxTtlSeconds * 1000,
            metadata: {
              name: vm.name,
              archilStatus: vm.status,
              vcpuCount: vm.vcpuCount,
              memSizeMiB: vm.memSizeMiB,
              baseImage: vm.baseImage,
              platform: vm.platform,
            },
          };
        }
        const diskInfo = 'status' in sandbox.disk ? sandbox.disk : undefined;
        return {
          id: sandbox.disk.id,
          provider: 'archil',
          status: !diskInfo || diskInfo.status === 'ready' ? 'running' : 'stopped',
          createdAt: diskInfo ? new Date(diskInfo.createdAt) : sandbox.createdAt,
          timeout: 0,
          metadata: diskInfo
            ? {
                name: diskInfo.name,
                organization: diskInfo.organization,
                region: diskInfo.region,
                provider: diskInfo.provider,
              }
            : {},
        };
      },

      getUrl: async (
        sandbox: ArchilSandbox,
        options: { port: number; protocol?: string },
      ): Promise<string> => {
        if (sandbox.vm) {
          await sandbox.vm.refresh();
          const endpoint = sandbox.vm.endpoints?.find(
            (e) => e.port === options.port,
          );
          if (!endpoint) {
            throw new Error(
              `No endpoint exposed on port ${options.port} for Archil sandbox ${sandbox.vm.id}.`,
            );
          }
          return `${options.protocol ?? 'https'}://${endpoint.hostname}`;
        }
        throw new Error(
          `Archil exec runs each command in a fresh ephemeral container that exits when the command returns, ` +
            `so there is no long-lived process to expose port ${options.port} on. ` +
            `getUrl is not supported.`,
        );
      },

      filesystem: {
        readFile: async (sandbox, path, runCommand) => {
          if (sandbox.vm) {
            const chunks: Buffer[] = [];
            try {
              await sandbox.vm.files.downloadFile(path, (chunk) => {
                chunks.push(Buffer.from(chunk));
              });
            } catch (error) {
              throw new Error(
                `Failed to read ${path}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
            return Buffer.concat(chunks).toString('utf8');
          }
          const diskPath = mapFilesystemPath(sandbox, path);
          const sizeResult = await runCommand(
            sandbox,
            `wc -c < ${shellEscape(diskPath)}`,
          );
          if (sizeResult.exitCode !== 0) {
            throw new Error(`Failed to read ${path}: ${sizeResult.stderr}`);
          }

          const sizeText = sizeResult.stdout.trim();
          if (!/^\d+$/.test(sizeText)) {
            throw new Error(
              `Failed to read ${path}: Archil returned an invalid file size.`,
            );
          }

          const size = Number(sizeText);
          if (!Number.isSafeInteger(size)) {
            throw new Error(
              `Failed to read ${path}: file size exceeds JavaScript's safe integer range.`,
            );
          }
          if (size === 0) return '';

          const chunks: Buffer[] = [];
          for (
            let offset = 0;
            offset < size;
            offset += ARCHIL_MAX_READ_CHUNK_BYTES
          ) {
            const expectedBytes = Math.min(
              ARCHIL_MAX_READ_CHUNK_BYTES,
              size - offset,
            );
            const result = await runCommand(
              sandbox,
              `dd if=${shellEscape(diskPath)} bs=1 skip=${offset} count=${expectedBytes} 2>/dev/null | base64`,
            );
            if (result.exitCode !== 0) {
              throw new Error(`Failed to read ${path}: ${result.stderr}`);
            }

            const encoded = result.stdout.replace(/\s/g, '');
            if (
              encoded.length === 0 ||
              encoded.length % 4 !== 0 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
            ) {
              throw new Error(
                `Failed to read ${path}: Archil returned an incomplete file chunk at byte ${offset}.`,
              );
            }

            const chunk = Buffer.from(encoded, 'base64');
            if (chunk.length !== expectedBytes) {
              throw new Error(
                `Failed to read ${path}: Archil returned an incomplete file chunk at byte ${offset}.`,
              );
            }
            chunks.push(chunk);
          }

          return Buffer.concat(chunks).toString('utf8');
        },

        writeFile: async (sandbox, path, content, runCommand) => {
          if (sandbox.vm) {
            try {
              await sandbox.vm.files.uploadFile(
                Buffer.from(content, 'utf8'),
                path,
              );
            } catch (error) {
              throw new Error(
                `Failed to write ${path}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
            return;
          }
          const diskPath = mapFilesystemPath(sandbox, path);
          const parent = posix.dirname(diskPath);
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          const tempPath = `${diskPath}.computesdk-write-${randomUUID()}`;
          let started = false;

          try {
            if (encoded.length === 0) {
              started = true;
              const result = await runCommand(
                sandbox,
                withDiskWriteLock(
                  sandbox,
                  [
                    `mkdir -p ${shellEscape(parent)}`,
                    `: > ${shellEscape(tempPath)}`,
                    finalizeStagedFileCommand(tempPath, diskPath),
                  ].join(' && '),
                ),
              );
              if (result.exitCode !== 0) {
                throw new Error(result.stderr);
              }
              return;
            }

            const chunkSize = maxWriteChunkSize(parent, tempPath, diskPath);
            for (let offset = 0; offset < encoded.length; offset += chunkSize) {
              const isFirst = offset === 0;
              const isFinal = offset + chunkSize >= encoded.length;
              started = true;
              const result = await runCommand(
                sandbox,
                withDiskWriteLock(
                  sandbox,
                  buildWriteChunkCommand(
                    parent,
                    tempPath,
                    diskPath,
                    encoded.slice(offset, offset + chunkSize),
                    isFirst,
                    isFinal,
                  ),
                ),
              );
              if (result.exitCode !== 0) {
                throw new Error(result.stderr);
              }
            }
          } catch (error) {
            if (started) {
              try {
                await runCommand(
                  sandbox,
                  withDiskWriteLock(sandbox, `rm -f ${shellEscape(tempPath)}`),
                );
              } catch {
                // Preserve the original write error if cleanup fails.
              }
            }
            throw new Error(
              `Failed to write ${path}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },

        mkdir: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(sandbox, path);
          const result = await runCommand(
            sandbox,
            withDiskWriteLock(sandbox, `mkdir -p ${shellEscape(diskPath)}`),
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(sandbox, path);
          // Tab-separated: type<TAB>size<TAB>mtime-iso<TAB>name. Robust to spaces in names.
          const result = await runCommand(
            sandbox,
            `find ${shellEscape(diskPath)} -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%T@\t%f\n'`,
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
          }
          const entries: FileEntry[] = [];
          for (const line of result.stdout.split('\n')) {
            if (!line) continue;
            const [typeChar, sizeStr, mtimeStr, ...nameParts] = line.split('\t');
            const name = nameParts.join('\t');
            entries.push({
              name,
              type: typeChar === 'd' ? 'directory' : 'file',
              size: parseInt(sizeStr, 10) || 0,
              modified: new Date(parseFloat(mtimeStr) * 1000),
            });
          }
          return entries;
        },

        exists: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(sandbox, path);
          const result = await runCommand(sandbox, `test -e ${shellEscape(diskPath)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(sandbox, path);
          if (!sandbox.vm && diskPath === ARCHIL_MOUNT_ROOT) {
            throw new Error('Refusing to remove the Archil disk mount root.');
          }
          const result = await runCommand(
            sandbox,
            withDiskWriteLock(sandbox, `rm -rf ${shellEscape(diskPath)}`),
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        },
      },

      // Native pause keeps CPU and memory: files anywhere (including /tmp)
      // and running processes survive. Processes must outlive the command
      // that started them (startProcess, or setsid): Archil reaps a command's
      // process group when it exits. Disk exec handles have no VM to pause.
      pause: async (sandbox: ArchilSandbox) => {
        await requireVm(sandbox, 'pause').pause();
      },

      resume: async (sandbox: ArchilSandbox) => {
        await requireVm(sandbox, 'resume').resume();
      },

      pauseCapabilities: { memory: true, createOptions: { ephemeral: false } },

      getInstance: (sandbox: ArchilSandbox): ArchilSandbox => sandbox,
    },

    // Archil has no separate snapshot resource. A snapshot is a fork of the
    // source VM (memory and disk), paused so it holds state without running,
    // and named with SNAPSHOT_NAME_PREFIX so it can be listed. create({
    // snapshotId }) forks it again. Forks must be deleted before their parent.
    snapshot: {
      // A fork copies the VM's memory and whole disk, so restores keep the
      // rootfs (including /tmp) and running processes; the source keeps running.
      capabilities: {
        scope: 'rootfs',
        memory: true,
        destroysSource: false,
        createOptions: { ephemeral: false },
      },

      create: async (
        config: ArchilConfig,
        sandboxId: string,
        options?: { name?: string },
      ) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        let fork: ArchilVm | undefined;
        try {
          const source = await client.sandboxes.get(sandboxId);
          fork = await source.fork({ name: snapshotName(options?.name) });
          if (fork.status === 'running') await fork.pause();
          return {
            id: fork.id,
            provider: 'archil',
            createdAt: fork.createdAt ?? new Date(),
            metadata: { name: options?.name, archilName: fork.name, sourceId: sandboxId },
          };
        } catch (error) {
          if (fork) await stopAndDeleteVm(fork).catch(() => {});
          throw new Error(
            `Failed to create Archil snapshot: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },

      list: async (config: ArchilConfig) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        const vms = await client.sandboxes.list();
        return vms
          .filter((vm) => isSnapshotVm(vm) && vm.status !== 'deleting' && vm.status !== 'deleted')
          .map((vm) => ({
            id: vm.id,
            provider: 'archil',
            createdAt: vm.createdAt,
            metadata: { archilName: vm.name, archilStatus: vm.status },
          }));
      },

      delete: async (config: ArchilConfig, snapshotId: string) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        let vm: ArchilVm;
        try {
          vm = await client.sandboxes.get(snapshotId);
        } catch (error) {
          if (error instanceof ArchilError && error.status === 404) return;
          throw error;
        }
        await stopAndDeleteVm(vm);
      },
    },
  },
});

export const archil = (config: ArchilConfig = {}) => _provider(config);

export type { ArchilSandbox };

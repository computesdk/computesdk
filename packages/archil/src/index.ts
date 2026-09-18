/**
 * Archil Provider
 *
 * Supports Archil's two compute surfaces, selected by `execution`:
 *
 * - "exec" (default): each command runs in an Archil-managed ephemeral
 *   container with the configured disk mounted, then returns stdout, stderr,
 *   and exit code. "create" resolves a handle to an existing disk id; env,
 *   cwd, and installs do not persist between commands.
 * - "persistent": `create` provisions an Archil sandbox — a persistent Linux
 *   VM with a dedicated disk. `runCommand` uses the sandbox's interactive
 *   process API (a short-lived WebSocket connection fetched fresh per command
 *   via POST /api/sandboxes/{id}/connections), so filesystem state, installed
 *   tools, and background processes persist across commands.
 */

import { defineProvider } from '@computesdk/provider';
import { Archil as ArchilClient } from 'disk';
import type {
  CreateSandboxRequest as ArchilSandboxRequest,
  Sandbox as ArchilVm,
} from 'disk';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
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
 * - "exec": serverless per-command containers on a disk (default).
 * - "persistent": a persistent sandbox VM run through the process API.
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
   * Which Archil compute surface to use. Defaults to "exec". In
   * "persistent" mode create() provisions a persistent sandbox VM instead of
   * resolving a disk handle. Per-sandbox override: `ephemeral` on
   * create() options (true -> exec handle, false -> persistent VM).
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
}

interface ArchilCreateOptions extends CreateSandboxOptions {
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

  return { apiKey, baseUrl, execution: config.execution ?? 'exec' };
}

function createClient(config: ArchilConfig, resolved: ResolvedConfig): ArchilClient {
  const region = config.region ?? process.env.ARCHIL_REGION ?? 'aws-us-east-1';
  return new ArchilClient({ ...resolved, region });
}

function resolveCreateDiskId(options?: ArchilCreateOptions): string {
  const diskId = options?.diskId;

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

  const envEntries = Object.entries(options?.env ?? {});
  if (!envEntries.some(([key]) => key === 'HOME')) {
    envEntries.unshift(['HOME', process.env.HOME || '/tmp']);
  }
  const envPrefix = envEntries
    .map(([k, v]) => `${k}=${shellEscape(String(v))}`)
    .join(' ');
  wrapped = `${envPrefix} ${wrapped}`;

  if (options?.cwd) {
    wrapped = `cd ${shellEscape(options.cwd)} && ${wrapped}`;
  }

  if (options?.background) {
    wrapped = `nohup sh -c ${shellEscape(wrapped)} > /dev/null 2>&1 &`;
  }

  return wrapped;
}

async function execOnDisk(sandbox: ArchilSandbox, command: string): Promise<ExecResponse> {
  return sandbox.client.disks.exec(sandbox.disk.id, command);
}

function wrapSandboxCommand(command: string, options?: RunCommandOptions): string {
  let wrapped = command;
  if (options?.cwd) {
    wrapped = `cd ${shellEscape(options.cwd)} && ${wrapped}`;
  }
  if (options?.background) {
    wrapped = `nohup sh -c ${shellEscape(wrapped)} > /dev/null 2>&1 &`;
  }
  return wrapped;
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
    // CreateSandboxOptions.timeout is milliseconds; Archil's TTL is seconds.
    request.maxTtlSeconds = Math.ceil(options.timeout / 1000);
  }
  return request;
}

// Records each sandbox's effective execution mode so `destroy` — which only
// receives an id — deletes persistent VMs even when the mode came from a
// per-sandbox `ephemeral` override rather than the provider config.
const sandboxModes = new Map<string, ArchilExecutionMode>();

const _provider = defineProvider<ArchilSandbox, ArchilConfig>({
  name: 'archil',
  methods: {
    sandbox: {
      create: async (config: ArchilConfig, options?: ArchilCreateOptions) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);

        // `ephemeral` on create() overrides the configured default for this
        // sandbox: true -> serverless exec handle, false -> persistent VM.
        const execution =
          options?.ephemeral !== undefined
            ? options.ephemeral
              ? 'exec'
              : 'persistent'
            : resolved.execution;

        if (execution === 'persistent') {
          const vm = await client.sandboxes.create(toSandboxRequest(options), {
            wait: true,
          });
          sandboxModes.set(vm.id, 'persistent');
          return {
            sandbox: {
              client,
              disk: { id: vm.id },
              vm,
              resolved,
              createdAt: new Date(),
            },
            sandboxId: vm.id,
          };
        }

        const diskId = resolveCreateDiskId(options);
        sandboxModes.set(diskId, 'exec');
        return {
          sandbox: {
            client,
            disk: { id: diskId },
            resolved,
            createdAt: new Date(),
          },
          sandboxId: diskId,
        };
      },

      getById: async (config: ArchilConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        try {
          if (resolved.execution === 'persistent') {
            const vm = await client.sandboxes.get(sandboxId);
            await ensureVmRunning(vm);
            return {
              sandbox: {
                client,
                disk: { id: vm.id },
                vm,
                resolved,
                createdAt: new Date(),
              },
              sandboxId: vm.id,
            };
          }
          const disk = await client.disks.get(sandboxId);
          return {
            sandbox: { client, disk, resolved, createdAt: new Date() },
            sandboxId: disk.id,
          };
        } catch {
          return null;
        }
      },

      list: async (config: ArchilConfig) => {
        const resolved = resolveConfig(config);
        const client = createClient(config, resolved);
        if (resolved.execution === 'persistent') {
          const vms = await client.sandboxes.list();
          return vms.map((vm) => ({
            sandbox: {
              client,
              disk: { id: vm.id },
              vm,
              resolved,
              createdAt: new Date(),
            },
            sandboxId: vm.id,
          }));
        }
        const disks = await client.disks.list();
        return disks.map((disk) => ({
          sandbox: { client, disk, resolved, createdAt: new Date() },
          sandboxId: disk.id,
        }));
      },

      destroy: async (config: ArchilConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        const mode = sandboxModes.get(sandboxId) ?? resolved.execution;
        if (mode === 'persistent') {
          const client = createClient(config, resolved);
          const vm = await client.sandboxes.get(sandboxId);
          await vm.delete();
        }
        // exec handles are disk references — Archil disks have an independent
        // lifecycle, so destroying them is a no-op. Unknown ids fall back to
        // the configured mode.
        sandboxModes.delete(sandboxId);
      },


      runCommand: async (
        sandbox: ArchilSandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          if (sandbox.vm) {
            // The process API fetches a fresh short-lived WebSocket
            // connection URL per process start, so expiry is handled by the
            // underlying client.
            await ensureVmRunning(sandbox.vm);
            const wrapped = wrapSandboxCommand(command, options);
            if (options?.background) {
              const proc = await sandbox.vm.processes.start(wrapped, {
                env: options?.env,
              });
              await proc.disconnect();
              return {
                stdout: '',
                stderr: '',
                exitCode: 0,
                durationMs: Date.now() - startTime,
              };
            }
            const result = await sandbox.vm.exec(wrapped, {
              env: options?.env,
              timeoutSeconds:
                options?.timeout !== undefined
                  ? Math.ceil(options.timeout / 1000)
                  : undefined,
            });
            return {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode:
                result.exitCode ?? (result.status === 'completed' ? 0 : 1),
              durationMs: Date.now() - startTime,
            };
          }

          const result = await execOnDisk(sandbox, wrapCommand(command, options));
          return {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: ArchilSandbox): Promise<SandboxInfo> => {
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

      getInstance: (sandbox: ArchilSandbox): ArchilSandbox => sandbox,
    },
  },
});

export const archil = (config: ArchilConfig = {}) => _provider(config);

export type { ArchilSandbox };

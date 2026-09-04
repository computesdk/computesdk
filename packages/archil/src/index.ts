/**
 * Archil Provider
 *
 * Executes commands against an Archil disk via the Archil control-plane HTTP
 * API. Archil is exec-only — each command runs in an Archil-managed container
 * with the configured disk mounted, then returns stdout, stderr, and exit code.
 * There is no sandbox lifecycle to manage; "create" resolves a handle to an
 * existing disk id.
 */

import { defineProvider } from '@computesdk/provider';
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

export interface ArchilConfig {
  /** Archil API key. Falls back to ARCHIL_API_KEY env var. */
  apiKey?: string;
  /** Archil region (e.g. "aws-us-east-1"). Falls back to ARCHIL_REGION env var. */
  region?: string;
  /** Override the control-plane base URL (useful for testing). */
  baseUrl?: string;
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
}

interface ArchilSandbox {
  disk: DiskHandle | DiskResponse;
  resolved: ResolvedConfig;
  createdAt: Date;
}

interface ArchilCreateOptions extends CreateSandboxOptions {
  diskId?: string;
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

  return { apiKey, baseUrl };
}

function authHeader(apiKey: string): string {
  return `key-${apiKey.replace(/^key-/, '')}`;
}

async function callApi<T>(
  resolved: ResolvedConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${resolved.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: authHeader(resolved.apiKey),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  type Envelope = { success?: boolean; data?: T; error?: string };
  let payload: Envelope | null = null;
  try {
    payload = (await response.json()) as Envelope;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.success === false) {
    const message =
      (payload && payload.error) ||
      `Archil API ${method} ${path} failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload.data as T;
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

function mapFilesystemPath(path: string): string {
  const normalized = posix.normalize(path.startsWith('/') ? path : `/${path}`);

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

function withDiskWriteLock(command: string): string {
  const mountRoot = shellEscape(ARCHIL_MOUNT_ROOT);
  return [
    `archil checkout --force --yes ${mountRoot}`,
    `{ ${command}; status=$?; archil checkin ${mountRoot}; checkin_status=$?; ` +
      `if [ $status -ne 0 ]; then exit $status; fi; exit $checkin_status; }`,
  ].join(' && ');
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
    const command = withDiskWriteLock(
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
  return callApi<ExecResponse>(
    sandbox.resolved,
    'POST',
    `/api/disks/${encodeURIComponent(sandbox.disk.id)}/exec`,
    { command },
  );
}

const _provider = defineProvider<ArchilSandbox, ArchilConfig>({
  name: 'archil',
  methods: {
    sandbox: {
      create: async (config: ArchilConfig, options?: ArchilCreateOptions) => {
        const resolved = resolveConfig(config);
        const diskId = resolveCreateDiskId(options);
        return {
          sandbox: { disk: { id: diskId }, resolved, createdAt: new Date() },
          sandboxId: diskId,
        };
      },

      getById: async (config: ArchilConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        try {
          const disk = await callApi<DiskResponse>(
            resolved,
            'GET',
            `/api/disks/${encodeURIComponent(sandboxId)}`,
          );
          return {
            sandbox: { disk, resolved, createdAt: new Date() },
            sandboxId: disk.id,
          };
        } catch {
          return null;
        }
      },

      list: async (config: ArchilConfig) => {
        const resolved = resolveConfig(config);
        const disks = await callApi<DiskResponse[]>(resolved, 'GET', '/api/disks');
        return disks.map((disk) => ({
          sandbox: { disk, resolved, createdAt: new Date() },
          sandboxId: disk.id,
        }));
      },

      destroy: async (_config: ArchilConfig, _sandboxId: string) => {
        // No-op: Archil disks have an independent lifecycle.
      },

      runCommand: async (
        sandbox: ArchilSandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
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
        _sandbox: ArchilSandbox,
        options: { port: number; protocol?: string },
      ): Promise<string> => {
        throw new Error(
          `Archil exec runs each command in a fresh ephemeral container that exits when the command returns, ` +
            `so there is no long-lived process to expose port ${options.port} on. ` +
            `getUrl is not supported.`,
        );
      },

      filesystem: {
        readFile: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(path);
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
          const diskPath = mapFilesystemPath(path);
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
                  withDiskWriteLock(`rm -f ${shellEscape(tempPath)}`),
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
          const diskPath = mapFilesystemPath(path);
          const result = await runCommand(
            sandbox,
            withDiskWriteLock(`mkdir -p ${shellEscape(diskPath)}`),
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(path);
          // Tab-separated: type<TAB>size<TAB>mtime-iso<TAB>name. Robust to spaces in names.
          const result = await runCommand(
            sandbox,
            `find ${shellEscape(diskPath)} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`,
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
          const diskPath = mapFilesystemPath(path);
          const result = await runCommand(sandbox, `test -e ${shellEscape(diskPath)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox, path, runCommand) => {
          const diskPath = mapFilesystemPath(path);
          if (diskPath === ARCHIL_MOUNT_ROOT) {
            throw new Error('Refusing to remove the Archil disk mount root.');
          }
          const result = await runCommand(
            sandbox,
            withDiskWriteLock(`rm -rf ${shellEscape(diskPath)}`),
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

/**
 * Archil Provider
 *
 * Executes commands against an Archil disk via the Archil control-plane HTTP
 * API. Archil is exec-only — each command runs in an Archil-managed container
 * with the configured disk mounted, then returns stdout, stderr, and exit code.
 * There is no sandbox lifecycle to manage; "create" just resolves a handle to
 * the target disk.
 */

import { defineProvider } from '@computesdk/provider';
import type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

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
  /** Default disk ID to exec against. Falls back to ARCHIL_DISK_ID env var. */
  diskId?: string;
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
  disk: DiskResponse;
  resolved: ResolvedConfig;
  createdAt: Date;
}

type ShellRunCommand = (
  sandbox: ArchilSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

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
  method: 'GET' | 'POST',
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

async function resolveDisk(
  config: ArchilConfig,
  resolved: ResolvedConfig,
  requestedDiskId?: string,
): Promise<DiskResponse> {
  const diskId = requestedDiskId ?? config.diskId ?? process.env.ARCHIL_DISK_ID;
  if (diskId) {
    return callApi<DiskResponse>(
      resolved,
      'GET',
      `/api/disks/${encodeURIComponent(diskId)}`,
    );
  }

  const disks = await callApi<DiskResponse[]>(resolved, 'GET', '/api/disks');
  if (disks.length === 0) {
    throw new Error(
      'No Archil disks found for this account/region.\n\n' +
        'Create a disk first or set ARCHIL_DISK_ID/archil({ diskId: "..." }).',
    );
  }

  if (disks.length === 1) {
    return disks[0];
  }

  const sample = disks
    .slice(0, 5)
    .map((disk) => `${disk.id}${disk.name ? ` (${disk.name})` : ''}`)
    .join(', ');

  throw new Error(
    `Multiple Archil disks found (${disks.length}). Specify one explicitly with ARCHIL_DISK_ID or archil({ diskId: "..." }).\n` +
      `Examples: ${sample}`,
  );
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function wrapCommand(command: string, options?: RunCommandOptions): string {
  let wrapped = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => `${k}=${shellEscape(String(v))}`)
      .join(' ');
    wrapped = `${envPrefix} ${wrapped}`;
  }

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
      create: async (config: ArchilConfig, options?: CreateSandboxOptions) => {
        const resolved = resolveConfig(config);
        const disk = await resolveDisk(
          config,
          resolved,
          options?.metadata?.diskId as string | undefined,
        );
        return {
          sandbox: { disk, resolved, createdAt: new Date() },
          sandboxId: disk.id,
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
        // No-op: Archil disks have a lifetime independent of compute exec calls.
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

      runCode: async (
        sandbox: ArchilSandbox,
        code: string,
        runtime?: Runtime,
        _config?: ArchilConfig,
      ): Promise<CodeResult> => {
        if (!runtime) {
          throw new Error(
            'Archil runCode requires an explicit runtime. Pass runtime: "node" or runtime: "python".',
          );
        }
        if (runtime !== 'node' && runtime !== 'python') {
          throw new Error(
            `Archil runCode does not support runtime "${runtime}". Supported runtimes: "node", "python".`,
          );
        }
        const interpreter = runtime === 'python' ? 'python3' : 'node';
        const flag = runtime === 'python' ? '-c' : '-e';
        const command = `${interpreter} ${flag} ${shellEscape(code)}`;

        const result = await execOnDisk(sandbox, command);
        const stdout = result.stdout ?? '';
        const stderr = result.stderr ?? '';
        const output = stderr ? `${stdout}${stdout && stderr ? '\n' : ''}${stderr}` : stdout;

        return {
          output,
          exitCode: result.exitCode,
          language: runtime,
        };
      },

      getInfo: async (sandbox: ArchilSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.disk.id,
          provider: 'archil',
          runtime: 'node',
          status: sandbox.disk.status === 'ready' ? 'running' : 'stopped',
          createdAt: new Date(sandbox.disk.createdAt),
          timeout: 0,
          metadata: {
            name: sandbox.disk.name,
            organization: sandbox.disk.organization,
            region: sandbox.disk.region,
            provider: sandbox.disk.provider,
          },
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
        readFile: async (sandbox: ArchilSandbox, path: string, runCommand: ShellRunCommand) => {
          const result = await runCommand(sandbox, `cat ${shellEscape(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to read ${path}: ${result.stderr}`);
          }
          return result.stdout;
        },

        writeFile: async (
          sandbox: ArchilSandbox,
          path: string,
          content: string,
          runCommand: ShellRunCommand,
        ) => {
          const parent = path.substring(0, path.lastIndexOf('/'));
          if (parent) {
            await runCommand(sandbox, `mkdir -p ${shellEscape(parent)}`);
          }
          // base64-pipe to avoid heredoc/quoting hazards on arbitrary content.
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          const result = await runCommand(
            sandbox,
            `printf %s ${shellEscape(encoded)} | base64 -d > ${shellEscape(path)}`,
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to write ${path}: ${result.stderr}`);
          }
        },

        mkdir: async (sandbox: ArchilSandbox, path: string, runCommand: ShellRunCommand) => {
          const result = await runCommand(sandbox, `mkdir -p ${shellEscape(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (sandbox: ArchilSandbox, path: string, runCommand: ShellRunCommand) => {
          // Tab-separated: type<TAB>size<TAB>mtime-iso<TAB>name. Robust to spaces in names.
          const result = await runCommand(
            sandbox,
            `find ${shellEscape(path)} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`,
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

        exists: async (sandbox: ArchilSandbox, path: string, runCommand: ShellRunCommand) => {
          const result = await runCommand(sandbox, `test -e ${shellEscape(path)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: ArchilSandbox, path: string, runCommand: ShellRunCommand) => {
          const result = await runCommand(sandbox, `rm -rf ${shellEscape(path)}`);
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

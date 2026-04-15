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
  RunCommandOptions,
} from 'computesdk';

const REGION_URLS: Record<string, string> = {
  'aws-us-east-1': 'https://control.green.us-east-1.aws.prod.archil.com',
  'aws-eu-west-1': 'https://control.green.eu-west-1.aws.prod.archil.com',
  'aws-us-west-2': 'https://control.green.us-west-2.aws.prod.archil.com',
  'gcp-us-central1': 'https://control.blue.us-central1.gcp.prod.archil.com',
};

export interface ArchilConfig {
  /** Archil API key. Falls back to ARCHIL_API_KEY env var. */
  apiKey?: string;
  /** Archil region (e.g. "aws-us-east-1"). Falls back to ARCHIL_REGION env var. */
  region?: string;
  /** Default disk ID to exec against. Can be overridden via sandboxId on create. */
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
          `Valid regions: ${Object.keys(REGION_URLS).join(', ')}`,
      );
    }
    const known = REGION_URLS[region];
    if (!known) {
      throw new Error(
        `Unknown Archil region "${region}". Valid regions: ${Object.keys(REGION_URLS).join(', ')}`,
      );
    }
    baseUrl = known;
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

function resolveDiskId(config: ArchilConfig, requested?: string): string {
  const diskId = requested ?? config.diskId;
  if (!diskId) {
    throw new Error(
      'Missing diskId for Archil.\n\n' +
        'Pass a default at construction: archil({ diskId: "..." })\n' +
        'Or pass one per call: provider.sandbox.create({ sandboxId: "<diskId>" })',
    );
  }
  return diskId;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function wrapCommand(command: string, options?: RunCommandOptions): string {
  let wrapped = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => `${k}=${shellEscape(v)}`)
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
        const diskId = resolveDiskId(config, (options?.sandboxId as string | undefined));
        const disk = await callApi<DiskResponse>(
          resolved,
          'GET',
          `/api/disks/${encodeURIComponent(diskId)}`,
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
      ): Promise<CodeResult> => {
        const effectiveRuntime: Runtime =
          runtime ||
          (code.includes('print(') ||
          code.includes('import ') ||
          code.includes('def ') ||
          code.includes('raise ')
            ? 'python'
            : 'node');

        const interpreter = effectiveRuntime === 'python' ? 'python3' : 'node';
        const flag = effectiveRuntime === 'python' ? '-c' : '-e';
        const command = `${interpreter} ${flag} ${shellEscape(code)}`;

        const result = await execOnDisk(sandbox, command);
        const stdout = result.stdout ?? '';
        const stderr = result.stderr ?? '';
        const output = stderr ? `${stdout}${stdout && stderr ? '\n' : ''}${stderr}` : stdout;

        return {
          output,
          exitCode: result.exitCode,
          language: effectiveRuntime,
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
          `Archil exec does not expose network ports. Cannot build URL for port ${options.port}.`,
        );
      },

      getInstance: (sandbox: ArchilSandbox): ArchilSandbox => sandbox,
    },
  },
});

export const archil = (config: ArchilConfig = {}) => _provider(config);

export type { ArchilSandbox };

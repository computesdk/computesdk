/**
 * Cloudflare Provider - Factory-based Implementation (Dual-Mode)
 *
 * Supports two connection modes:
 *
 * 1. **Remote mode** — User deploys the Cloudflare sandbox demo Worker, then
 *    connects from anywhere using sandboxUrl + sandboxApiKey.
 *
 * 2. **Direct mode** — User's code runs inside a Cloudflare Worker with a
 *    cross-script Durable Object binding to the sandbox demo Worker.
 *
 * The mode is selected automatically based on which config fields are provided.
 */

import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 15 * 60_000;
const WRITE_CHUNK_BYTES = 48 * 1024;

export interface CloudflareDirectExecOutput {
  stdout: ArrayBuffer;
  stderr: ArrayBuffer;
  exitCode: number;
}

export interface CloudflareSandboxStub {
  start(): Promise<void>;
  exec(
    argv: string[],
    cwd: string | undefined,
    timeoutMs: number
  ): Promise<CloudflareDirectExecOutput>;
  destroy(): Promise<void>;
}

export interface CloudflareDurableObjectId {
  toString(): string;
}

export interface CloudflareSandboxBinding {
  newUniqueId(): CloudflareDurableObjectId;
  idFromString(id: string): CloudflareDurableObjectId;
  get(id: CloudflareDurableObjectId): CloudflareSandboxStub;
}

export interface CloudflareConfig {
  /** URL of the deployed sandbox demo Worker. */
  sandboxUrl?: string;
  /** API key that matches the Worker's SANDBOX_API_KEY secret. */
  sandboxApiKey?: string;
  /** @deprecated Use sandboxApiKey instead. */
  sandboxSecret?: string;
  /** Durable Object namespace exported by the sandbox demo Worker. */
  sandboxBinding?: CloudflareSandboxBinding;
  /** Default execution timeout in milliseconds. */
  timeout?: number;
  /** Environment variables passed to every command. */
  envVars?: Record<string, string>;
}

interface CloudflareSandbox {
  sandboxId: string;
  remote: boolean;
  timeoutMs: number;
  sandboxUrl?: string;
  sandboxApiKey?: string;
  pendingEnvVars?: Record<string, string>;
  sandbox?: CloudflareSandboxStub;
}

function isRemote(config: CloudflareConfig): boolean {
  return !!(config.sandboxUrl && getSandboxApiKey(config));
}

function getSandboxApiKey(config: CloudflareConfig): string | undefined {
  return config.sandboxApiKey || config.sandboxSecret;
}

function isBridgeSandboxId(sandboxId: string): boolean {
  return /^[0-9a-f]{64}$/.test(sandboxId);
}

function executionTimeout(timeoutMs: number): number {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_EXEC_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Execution timeout must be greater than 0 and no greater than ${MAX_EXEC_TIMEOUT_MS} milliseconds`
    );
  }
  return timeoutMs;
}

function directBinding(config: CloudflareConfig): CloudflareSandboxBinding {
  return config.sandboxBinding!;
}

async function createBridgeSandboxId(
  config: CloudflareConfig
): Promise<string> {
  const sandboxApiKey = getSandboxApiKey(config)!;
  const data = await bridgeJSONRequest(
    {
      sandboxId: '',
      remote: true,
      timeoutMs: config.timeout ?? DEFAULT_EXEC_TIMEOUT_MS,
      sandboxUrl: config.sandboxUrl,
      sandboxApiKey,
    },
    'POST',
    '/v1/sandbox'
  );

  if (typeof data.id !== 'string' || !isBridgeSandboxId(data.id)) {
    throw new Error(
      'Sandbox Worker create failed: missing or invalid sandbox id'
    );
  }

  return data.id;
}

function bridgeUrl(cfSandbox: CloudflareSandbox, path: string): string {
  const base = (cfSandbox.sandboxUrl || '').replace(/\/$/, '');
  return `${base}${path}`;
}

async function bridgeRequest(
  cfSandbox: CloudflareSandbox,
  method: string,
  path: string,
  body?: BodyInit,
  headers: Record<string, string> = {}
): Promise<Response> {
  const response = await fetch(bridgeUrl(cfSandbox, path), {
    method,
    headers: {
      Authorization: `Bearer ${cfSandbox.sandboxApiKey || ''}`,
      ...headers,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `Sandbox Worker request failed: ${response.status} - ${text.slice(
        0,
        200
      )}`
    );
  }

  return response;
}

async function bridgeJSONRequest(
  cfSandbox: CloudflareSandbox,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<any> {
  const response = await bridgeRequest(
    cfSandbox,
    method,
    path,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? {} : { 'Content-Type': 'application/json' }
  );

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function parseBridgeExecEvents(
  text: string
): Pick<CommandResult, 'stdout' | 'stderr' | 'exitCode'> {
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;

  for (const rawEvent of text.split(/\r?\n\r?\n/)) {
    const lines = rawEvent.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) continue;

    let event = 'message';
    const data: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }

    const payload = data.join('\n');
    if (event === 'stdout') {
      stdout += Buffer.from(payload, 'base64').toString('utf8');
    } else if (event === 'stderr') {
      stderr += Buffer.from(payload, 'base64').toString('utf8');
    } else if (event === 'exit') {
      const parsed = JSON.parse(payload);
      const parsedExitCode = parsed.exit_code ?? parsed.exitCode;
      if (
        typeof parsedExitCode !== 'number' ||
        !Number.isFinite(parsedExitCode)
      ) {
        throw new Error(
          'Sandbox Worker exec response contained an invalid exit event'
        );
      }
      exitCode = parsedExitCode;
    } else if (event === 'error') {
      try {
        const parsed = JSON.parse(payload);
        stderr += parsed.error || parsed.message || payload;
      } catch {
        stderr += payload;
      }
      exitCode ??= 1;
    }
  }

  if (exitCode === undefined) {
    throw new Error('Sandbox Worker exec response ended without an exit event');
  }
  return { stdout, stderr, exitCode };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function findStartingPath(path: string): string {
  return path === '' || path.startsWith('/') ? path : `./${path}`;
}

function envPrefix(envVars?: Record<string, string>): string {
  if (!envVars || Object.keys(envVars).length === 0) return '';

  return (
    Object.entries(envVars)
      .map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          throw new Error(`Invalid environment variable name: ${key}`);
        }
        return `export ${key}=${shellQuote(value)};`;
      })
      .join(' ') + ' '
  );
}

function commandForSandbox(
  cfSandbox: CloudflareSandbox,
  command: string,
  options?: RunCommandOptions
): string {
  const envVars = { ...cfSandbox.pendingEnvVars, ...options?.env };
  const backgroundCommand = options?.background
    ? `nohup ${command} > /dev/null 2>&1 &`
    : command;
  return `${envPrefix(envVars)}${backgroundCommand}`;
}

async function bridgeExec(
  cfSandbox: CloudflareSandbox,
  command: string,
  options?: RunCommandOptions
): Promise<CommandResult> {
  const startTime = Date.now();
  const response = await bridgeRequest(
    cfSandbox,
    'POST',
    `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/exec`,
    JSON.stringify({
      argv: ['sh', '-lc', commandForSandbox(cfSandbox, command, options)],
      cwd: options?.cwd,
      timeout_ms: executionTimeout(options?.timeout ?? cfSandbox.timeoutMs),
    }),
    { 'Content-Type': 'application/json' }
  );

  return {
    ...parseBridgeExecEvents(await response.text()),
    durationMs: Date.now() - startTime,
  };
}

async function directExec(
  cfSandbox: CloudflareSandbox,
  command: string,
  options?: RunCommandOptions
): Promise<CommandResult> {
  if (!cfSandbox.sandbox) throw new Error('Missing Cloudflare sandbox binding');

  const startTime = Date.now();
  const output = await cfSandbox.sandbox.exec(
    ['sh', '-lc', commandForSandbox(cfSandbox, command, options)],
    options?.cwd,
    executionTimeout(options?.timeout ?? cfSandbox.timeoutMs)
  );

  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    exitCode: output.exitCode,
    durationMs: Date.now() - startTime,
  };
}

function exec(
  cfSandbox: CloudflareSandbox,
  command: string,
  options?: RunCommandOptions
): Promise<CommandResult> {
  return cfSandbox.remote
    ? bridgeExec(cfSandbox, command, options)
    : directExec(cfSandbox, command, options);
}

function assertCommandSucceeded(result: CommandResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${action} failed: ${result.stderr || `exit ${result.exitCode}`}`
    );
  }
}

function parseFindOutput(stdout: string): FileEntry[] {
  const fields = stdout.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 4 !== 0) {
    throw new Error('Directory listing returned malformed output');
  }

  const entries: FileEntry[] = [];
  for (let index = 0; index < fields.length; index += 4) {
    const [kind, sizeText, modifiedText, name] = fields.slice(index, index + 4);
    const size = Number.parseInt(sizeText, 10);
    const modifiedMs = Number.parseFloat(modifiedText) * 1000;
    if (
      !kind ||
      !name ||
      !Number.isFinite(size) ||
      !Number.isFinite(modifiedMs)
    ) {
      throw new Error('Directory listing returned malformed output');
    }

    entries.push({
      name,
      type: kind === 'd' ? 'directory' : 'file',
      size,
      modified: new Date(modifiedMs),
    });
  }

  return entries;
}

export const cloudflare = defineProvider<CloudflareSandbox, CloudflareConfig>({
  name: 'cloudflare',
  methods: {
    sandbox: {
      create: async (
        config: CloudflareConfig,
        options?: CreateSandboxOptions
      ) => {
        const envVars = { ...config.envVars, ...options?.envs };
        const timeoutMs = executionTimeout(
          config.timeout ?? DEFAULT_EXEC_TIMEOUT_MS
        );

        if (isRemote(config)) {
          const sandboxId =
            options?.sandboxId || (await createBridgeSandboxId(config));
          if (!isBridgeSandboxId(sandboxId)) {
            throw new Error(
              'Invalid Cloudflare sandbox ID. Expected a 64-character hexadecimal Durable Object ID.'
            );
          }

          const sandboxApiKey = getSandboxApiKey(config)!;
          return {
            sandbox: {
              sandboxId,
              remote: true,
              timeoutMs,
              sandboxUrl: config.sandboxUrl,
              sandboxApiKey,
              pendingEnvVars:
                Object.keys(envVars).length > 0 ? envVars : undefined,
            },
            sandboxId,
          };
        }

        if (!config.sandboxBinding) {
          throw new Error(
            'Missing Cloudflare config. Set sandboxUrl + sandboxApiKey for remote mode or provide sandboxBinding for direct mode.'
          );
        }

        try {
          const binding = directBinding(config);
          const objectId = options?.sandboxId
            ? binding.idFromString(options.sandboxId)
            : binding.newUniqueId();
          const sandbox = binding.get(objectId);
          await sandbox.start();
          const sandboxId = objectId.toString();

          return {
            sandbox: {
              sandbox,
              sandboxId,
              remote: false,
              timeoutMs,
              pendingEnvVars:
                Object.keys(envVars).length > 0 ? envVars : undefined,
            },
            sandboxId,
          };
        } catch (error) {
          throw new Error(
            `Failed to create Cloudflare sandbox: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      getById: async (config: CloudflareConfig, sandboxId: string) => {
        if (!isBridgeSandboxId(sandboxId)) return null;

        const timeoutMs = executionTimeout(
          config.timeout ?? DEFAULT_EXEC_TIMEOUT_MS
        );
        const pendingEnvVars =
          config.envVars && Object.keys(config.envVars).length > 0
            ? config.envVars
            : undefined;

        if (isRemote(config)) {
          const sandboxApiKey = getSandboxApiKey(config)!;
          const sandbox: CloudflareSandbox = {
            sandboxId,
            remote: true,
            timeoutMs,
            sandboxUrl: config.sandboxUrl,
            sandboxApiKey,
            pendingEnvVars,
          };
          try {
            const result = await bridgeExec(sandbox, 'true');
            return result.exitCode === 0 ? { sandbox, sandboxId } : null;
          } catch {
            return null;
          }
        }

        if (!config.sandboxBinding) return null;

        try {
          const binding = directBinding(config);
          const sandbox = binding.get(binding.idFromString(sandboxId));
          const output = await sandbox.exec(['true'], undefined, timeoutMs);
          if (output.exitCode !== 0) return null;

          return {
            sandbox: {
              sandbox,
              sandboxId,
              remote: false,
              timeoutMs,
              pendingEnvVars,
            },
            sandboxId,
          };
        } catch {
          return null;
        }
      },

      list: async () => {
        throw new Error(
          'Cloudflare does not support listing sandboxes. Use getById to reconnect to a specific sandbox ID.'
        );
      },

      destroy: async (config: CloudflareConfig, sandboxId: string) => {
        if (isRemote(config)) {
          const sandboxApiKey = getSandboxApiKey(config)!;
          await bridgeJSONRequest(
            {
              sandboxId,
              remote: true,
              timeoutMs: config.timeout ?? DEFAULT_EXEC_TIMEOUT_MS,
              sandboxUrl: config.sandboxUrl,
              sandboxApiKey,
            },
            'DELETE',
            `/v1/sandbox/${encodeURIComponent(sandboxId)}`
          );
        } else if (config.sandboxBinding) {
          const binding = directBinding(config);
          const sandbox = binding.get(binding.idFromString(sandboxId));
          await sandbox.destroy();
        }
      },

      runCommand: async (
        cfSandbox: CloudflareSandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          return await exec(cfSandbox, command, options);
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (cfSandbox: CloudflareSandbox): Promise<SandboxInfo> => {
        try {
          const result = await exec(cfSandbox, 'true');
          if (result.exitCode !== 0) throw new Error(result.stderr);

          return {
            id: cfSandbox.sandboxId,
            provider: 'cloudflare',
            status: 'running',
            createdAt: new Date(),
            timeout: cfSandbox.timeoutMs,
            metadata: { mode: cfSandbox.remote ? 'remote' : 'direct' },
          };
        } catch (error) {
          return {
            id: cfSandbox.sandboxId,
            provider: 'cloudflare',
            status: 'error',
            createdAt: new Date(),
            timeout: cfSandbox.timeoutMs,
            metadata: {
              mode: cfSandbox.remote ? 'remote' : 'direct',
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },

      getUrl: async () => {
        throw new Error(
          'Cloudflare sandbox Worker does not support port forwarding'
        );
      },

      filesystem: {
        readFile: async (cfSandbox: CloudflareSandbox, path: string) => {
          const result = await exec(cfSandbox, `cat -- ${shellQuote(path)}`);
          assertCommandSucceeded(result, 'File read');
          return result.stdout;
        },

        writeFile: async (
          cfSandbox: CloudflareSandbox,
          path: string,
          content: string
        ): Promise<void> => {
          const tempPath = `/tmp/.computesdk-${crypto.randomUUID()}`;
          try {
            let result = await exec(cfSandbox, `: > ${shellQuote(tempPath)}`);
            assertCommandSucceeded(result, 'Temporary file creation');

            const bytes = new TextEncoder().encode(content);
            for (
              let offset = 0;
              offset < bytes.length;
              offset += WRITE_CHUNK_BYTES
            ) {
              const encoded = Buffer.from(
                bytes.subarray(offset, offset + WRITE_CHUNK_BYTES)
              ).toString('base64');
              result = await exec(
                cfSandbox,
                `printf %s ${shellQuote(encoded)} | base64 -d >> ${shellQuote(
                  tempPath
                )}`
              );
              assertCommandSucceeded(result, 'File write');
            }

            result = await exec(
              cfSandbox,
              `cat -- ${shellQuote(tempPath)} > ${shellQuote(
                path
              )} && rm -f -- ${shellQuote(tempPath)}`
            );
            assertCommandSucceeded(result, 'File write');
          } catch (error) {
            await exec(cfSandbox, `rm -f -- ${shellQuote(tempPath)}`).catch(
              () => undefined
            );
            throw error;
          }
        },

        mkdir: async (
          cfSandbox: CloudflareSandbox,
          path: string
        ): Promise<void> => {
          const result = await exec(
            cfSandbox,
            `mkdir -p -- ${shellQuote(path)}`
          );
          assertCommandSucceeded(result, 'Directory creation');
        },

        readdir: async (
          cfSandbox: CloudflareSandbox,
          path: string
        ): Promise<FileEntry[]> => {
          const result = await exec(
            cfSandbox,
            `find -- ${shellQuote(
              findStartingPath(path)
            )} -mindepth 1 -maxdepth 1 -printf '%y\\0%s\\0%T@\\0%f\\0'`
          );
          assertCommandSucceeded(result, 'Directory listing');
          return parseFindOutput(result.stdout);
        },

        exists: async (
          cfSandbox: CloudflareSandbox,
          path: string
        ): Promise<boolean> => {
          const result = await exec(cfSandbox, `test -e ${shellQuote(path)}`);
          return result.exitCode === 0;
        },

        remove: async (
          cfSandbox: CloudflareSandbox,
          path: string
        ): Promise<void> => {
          const result = await exec(cfSandbox, `rm -rf -- ${shellQuote(path)}`);
          assertCommandSucceeded(result, 'File removal');
        },
      },
    },
  },
});

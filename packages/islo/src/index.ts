import { defineProvider, escapeShellArg } from '@computesdk/provider';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve as resolvePath } from 'path';

import type {
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  RunCommandOptions,
} from '@computesdk/provider';

const DEFAULT_API_URL = 'https://api.islo.dev';
const DEFAULT_NODE_IMAGE = 'docker.io/library/node:20-bookworm';
const DEFAULT_PYTHON_IMAGE = 'docker.io/library/python:3.12-slim';
const DEFAULT_TIMEOUT_MS = 300000;

interface IsloNetwork {
  ip?: string | null;
  mac?: string | null;
}

interface IsloSpec {
  vcpus: number;
  memory_mb: number;
  disk_gb: number;
}

interface IsloApiSandbox {
  id: string;
  name: string;
  status: string;
  image: string;
  network?: IsloNetwork | null;
  spec?: IsloSpec;
  created_at?: string | null;
}

interface IsloSandbox extends IsloApiSandbox {
  apiUrl: string;
  authHeaders: Record<string, string>;
  timeoutMs: number;
  publicHost?: string;
}

interface IsloExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ResolvedConfig {
  apiUrl: string;
  authHeaders: Record<string, string>;
  timeoutMs: number;
  image?: string;
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  runtime?: Runtime;
  publicHost?: string;
}

export interface IsloConfig {
  /** Islo API base URL. Defaults to ISLO_API_URL or https://api.islo.dev */
  apiUrl?: string;
  /** Islo bearer token. Defaults to ISLO_BEARER_TOKEN */
  bearerToken?: string;
  /** Path to Islo auth file. Defaults to ISLO_AUTH_FILE or ~/.islo/auth.json */
  authFilePath?: string;
  /** Optional tenant context header. Defaults to ISLO_PUBLIC_TENANT_ID */
  tenantPublicId?: string;
  /** Optional user context header. Defaults to ISLO_PUBLIC_USER_ID */
  userPublicId?: string;
  /** Default image for new sandboxes */
  image?: string;
  /** Default vCPU count for new sandboxes */
  vcpus?: number;
  /** Default memory in MB for new sandboxes */
  memoryMb?: number;
  /** Default disk in GB for new sandboxes */
  diskGb?: number;
  /** Default command timeout in milliseconds */
  timeout?: number;
  /** Default runtime hint */
  runtime?: Runtime;
  /** Optional public host used by getUrl when IP is unavailable */
  publicHost?: string;
}

/**
 * Create an Islo provider instance using the factory pattern.
 */
export const islo = defineProvider<IsloSandbox, IsloConfig>({
  name: 'islo',
  methods: {
    sandbox: {
      create: async (config: IsloConfig, options?: CreateSandboxOptions) => {
        const resolved = resolveConfig(config);

        const requestedName = options?.name || createSandboxName();
        const effectiveRuntime = options?.runtime || resolved.runtime || 'node';

        const image =
          asNonEmptyString(options?.image) ||
          resolved.image ||
          defaultImageForRuntime(effectiveRuntime);

        const vcpus = parsePositiveInt(options?.vcpus) ?? resolved.vcpus ?? 2;
        const memoryMb =
          parsePositiveInt(options?.memoryMb) ??
          parsePositiveInt(options?.memory_mb) ??
          resolved.memoryMb ??
          2048;
        const diskGb =
          parsePositiveInt(options?.diskGb) ??
          parsePositiveInt(options?.disk_gb) ??
          resolved.diskGb ??
          10;

        const payload: Record<string, unknown> = {
          name: requestedName,
          image,
          vcpus,
          memory_mb: memoryMb,
          disk_gb: diskGb,
        };

        if (options?.envs && typeof options.envs === 'object') {
          payload.env = options.envs;
        }

        const created = await fetchJson<Partial<IsloApiSandbox>>(
          `${resolved.apiUrl}/sandboxes/`,
          {
            method: 'POST',
            headers: withJsonHeaders(resolved.authHeaders),
            body: JSON.stringify(payload),
          }
        );

        const sandboxName = asNonEmptyString(created.name) || requestedName;
        const sandbox = createSandboxState(created, sandboxName, resolved);

        return {
          sandbox,
          sandboxId: sandbox.name,
        };
      },

      getById: async (config: IsloConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);

        const response = await fetch(
          `${resolved.apiUrl}/sandboxes/${encodeURIComponent(sandboxId)}`,
          {
            method: 'GET',
            headers: resolved.authHeaders,
          }
        );

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch Islo sandbox '${sandboxId}' (${response.status}): ${await safeReadText(response)}`
          );
        }

        const data = (await response.json()) as Partial<IsloApiSandbox>;
        const sandbox = createSandboxState(data, sandboxId, resolved);

        return {
          sandbox,
          sandboxId: sandbox.name,
        };
      },

      list: async (config: IsloConfig) => {
        const resolved = resolveConfig(config);

        try {
          const sandboxes = await fetchJson<Array<Partial<IsloApiSandbox>>>(
            `${resolved.apiUrl}/sandboxes/`,
            {
              method: 'GET',
              headers: resolved.authHeaders,
            }
          );

          return sandboxes.map((item, index) => {
            const fallbackName =
              asNonEmptyString(item.name) ||
              asNonEmptyString(item.id) ||
              `islo-sandbox-${index + 1}`;
            const sandbox = createSandboxState(item, fallbackName, resolved);
            return {
              sandbox,
              sandboxId: sandbox.name,
            };
          });
        } catch (_error) {
          return [];
        }
      },

      destroy: async (config: IsloConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);

        const response = await fetch(
          `${resolved.apiUrl}/sandboxes/${encodeURIComponent(sandboxId)}`,
          {
            method: 'DELETE',
            headers: resolved.authHeaders,
          }
        );

        if (response.status === 404 || response.status === 410) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to delete Islo sandbox '${sandboxId}' (${response.status}): ${await safeReadText(response)}`
          );
        }
      },

      runCode: async (
        sandbox: IsloSandbox,
        code: string,
        runtime?: Runtime
      ): Promise<CodeResult> => {
        const effectiveRuntime =
          runtime || detectRuntime(code, inferRuntimeFromImage(sandbox.image));
        const command = buildRuntimeCommand(code, effectiveRuntime);

        const result = await runCommandViaSse(sandbox, command, {
          timeoutMs: sandbox.timeoutMs,
        });

        const output = combineOutput(result.stdout, result.stderr);

        if (result.exitCode !== 0 && isSyntaxError(output, effectiveRuntime)) {
          throw new Error(`Syntax error: ${firstNonEmptyLine(output)}`);
        }

        return {
          output,
          exitCode: result.exitCode,
          language: effectiveRuntime,
        };
      },

      runCommand: async (
        sandbox: IsloSandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        const timeoutMs = parsePositiveInt(options?.timeout) ?? sandbox.timeoutMs;

        const shellCommand = buildShellCommand(command, options);
        try {
          const result = await runCommandViaSse(sandbox, shellCommand, {
            cwd: options?.cwd,
            timeoutMs,
          });

          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: IsloSandbox): Promise<SandboxInfo> => {
        const createdAt = parseDateOrNow(sandbox.created_at);

        return {
          id: sandbox.name,
          provider: 'islo',
          runtime: inferRuntimeFromImage(sandbox.image),
          status: mapStatus(sandbox.status),
          createdAt,
          timeout: sandbox.timeoutMs,
          metadata: {
            isloSandboxId: sandbox.id,
            image: sandbox.image,
            vcpus: sandbox.spec?.vcpus,
            memoryMb: sandbox.spec?.memory_mb,
            diskGb: sandbox.spec?.disk_gb,
          },
        };
      },

      getUrl: async (
        sandbox: IsloSandbox,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        const protocol = options.protocol || 'https';

        if (sandbox.network?.ip) {
          return `${protocol}://${sandbox.network.ip}:${options.port}`;
        }

        if (sandbox.publicHost) {
          return `${protocol}://${sandbox.publicHost}:${options.port}`;
        }

        const apiHost = new URL(sandbox.apiUrl).host;
        return `${protocol}://${sandbox.name}.${apiHost}:${options.port}`;
      },
    },
  },
});

function resolveConfig(config: IsloConfig): ResolvedConfig {
  const apiUrl = normalizeBaseUrl(
    config.apiUrl || process.env.ISLO_API_URL || DEFAULT_API_URL
  );

  const bearerToken =
    asNonEmptyString(config.bearerToken) ||
    asNonEmptyString(
      typeof process !== 'undefined' ? process.env?.ISLO_BEARER_TOKEN : undefined
    ) ||
    readTokenFromAuthFile(config.authFilePath) ||
    '';

  if (!bearerToken) {
    throw new Error(
      `Missing Islo bearer token. Set ISLO_BEARER_TOKEN, pass 'bearerToken', or run 'islo auth login' so ~/.islo/auth.json contains a session token.`
    );
  }

  const timeoutMs =
    parsePositiveInt(config.timeout) ??
    parsePositiveInt(process.env.ISLO_TIMEOUT_MS) ??
    DEFAULT_TIMEOUT_MS;

  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
  };

  const tenantPublicId =
    config.tenantPublicId || process.env.ISLO_PUBLIC_TENANT_ID;
  const userPublicId = config.userPublicId || process.env.ISLO_PUBLIC_USER_ID;

  if (tenantPublicId) {
    authHeaders['X-Public-Tenant-Id'] = tenantPublicId;
  }

  if (userPublicId) {
    authHeaders['X-Public-User-Id'] = userPublicId;
  }

  return {
    apiUrl,
    authHeaders,
    timeoutMs,
    image: config.image || process.env.ISLO_IMAGE,
    vcpus: parsePositiveInt(config.vcpus) ?? parsePositiveInt(process.env.ISLO_VCPUS),
    memoryMb:
      parsePositiveInt(config.memoryMb) ??
      parsePositiveInt(process.env.ISLO_MEMORY_MB),
    diskGb: parsePositiveInt(config.diskGb) ?? parsePositiveInt(process.env.ISLO_DISK_GB),
    runtime: config.runtime,
    publicHost: config.publicHost || process.env.ISLO_PUBLIC_HOST,
  };
}

function createSandboxState(
  source: Partial<IsloApiSandbox>,
  fallbackName: string,
  config: ResolvedConfig
): IsloSandbox {
  const name = asNonEmptyString(source.name) || fallbackName;
  const runtime = config.runtime || 'node';

  return {
    id: asNonEmptyString(source.id) || name,
    name,
    status: asNonEmptyString(source.status) || 'running',
    image: asNonEmptyString(source.image) || config.image || defaultImageForRuntime(runtime),
    network: source.network ?? null,
    spec: source.spec,
    created_at:
      source.created_at === undefined ? new Date().toISOString() : source.created_at,
    apiUrl: config.apiUrl,
    authHeaders: config.authHeaders,
    timeoutMs: config.timeoutMs,
    publicHost: config.publicHost,
  };
}

function detectRuntime(code: string, fallback: Runtime = 'node'): Runtime {
  if (
    code.includes('console.log(') ||
    code.includes('process.') ||
    code.includes('require(') ||
    code.includes('throw new Error')
  ) {
    return 'node';
  }

  if (
    code.includes('print(') ||
    code.includes('import ') ||
    code.includes('def ') ||
    code.includes('raise ') ||
    code.includes('Traceback')
  ) {
    return 'python';
  }

  return fallback;
}

function inferRuntimeFromImage(image: string): Runtime {
  const normalized = image.toLowerCase();

  if (normalized.includes('python')) {
    return 'python';
  }

  if (normalized.includes('deno')) {
    return 'deno';
  }

  if (normalized.includes('bun')) {
    return 'bun';
  }

  return 'node';
}

function buildRuntimeCommand(code: string, runtime: Runtime): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');

  if (runtime === 'python') {
    return `echo "${encoded}" | base64 -d | (if command -v python3 >/dev/null 2>&1; then python3; else python; fi)`;
  }

  if (runtime === 'deno') {
    return `echo "${encoded}" | base64 -d | deno run -`;
  }

  if (runtime === 'bun') {
    return `echo "${encoded}" | base64 -d | bun`;
  }

  return `echo "${encoded}" | base64 -d | node`;
}

function buildShellCommand(command: string, options?: RunCommandOptions): string {
  let fullCommand = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([key, value]) => `${key}="${escapeShellArg(value)}"`)
      .join(' ');
    fullCommand = `${envPrefix} ${fullCommand}`;
  }

  if (options?.background) {
    fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
  }

  return fullCommand;
}

async function runCommandViaSse(
  sandbox: IsloSandbox,
  command: string,
  options: { cwd?: string; timeoutMs: number }
): Promise<IsloExecResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(
      `${sandbox.apiUrl}/sandboxes/${encodeURIComponent(sandbox.name)}/exec/stream`,
      {
        method: 'POST',
        headers: {
          ...withJsonHeaders(sandbox.authHeaders),
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          command: ['/bin/sh', '-lc', command],
          ...(options.cwd ? { cwd: options.cwd } : {}),
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Islo exec failed (${response.status}): ${await safeReadText(response)}`
      );
    }

    if (!response.body) {
      throw new Error('Islo exec stream did not include a response body.');
    }

    return await parseSseResult(response.body);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Islo command timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function parseSseResult(body: ReadableStream<Uint8Array>): Promise<IsloExecResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;
  let pendingError: string | null = null;

  let buffer = '';
  let currentEvent = 'message';
  let dataLines: string[] = [];

  const emitEvent = () => {
    if (dataLines.length === 0) {
      currentEvent = 'message';
      return;
    }

    const payload = dataLines.join('\n');

    switch (currentEvent) {
      case 'stdout':
        stdout += payload;
        break;
      case 'stderr':
        stderr += payload;
        break;
      case 'exit': {
        const parsed = parseInt(payload, 10);
        if (Number.isInteger(parsed)) {
          exitCode = parsed;
        }
        break;
      }
      case 'error':
        pendingError = pendingError ? `${pendingError}\n${payload}` : payload;
        break;
      default:
        break;
    }

    currentEvent = 'message';
    dataLines = [];
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') {
      emitEvent();
      return;
    }

    if (line.startsWith(':')) {
      return;
    }

    if (line.startsWith('event:')) {
      currentEvent = line.slice('event:'.length).trim();
      return;
    }

    if (line.startsWith('data:')) {
      const rawData = line.slice('data:'.length);
      dataLines.push(rawData.startsWith(' ') ? rawData.slice(1) : rawData);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    handleLine(buffer);
  }

  emitEvent();

  if (pendingError) {
    throw new Error(`Islo exec stream error: ${pendingError}`);
  }

  if (exitCode === null) {
    throw new Error('Islo exec stream ended without an exit event.');
  }

  return {
    stdout,
    stderr,
    exitCode,
  };
}

function combineOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) {
    const needsSeparator = !stdout.endsWith('\n') && !stderr.startsWith('\n');
    return needsSeparator ? `${stdout}\n${stderr}` : `${stdout}${stderr}`;
  }

  return stdout || stderr;
}

function mapStatus(status: string): SandboxInfo['status'] {
  const normalized = status.toLowerCase();

  if (normalized === 'running' || normalized === 'ready' || normalized === 'starting') {
    return 'running';
  }

  if (normalized === 'stopped') {
    return 'stopped';
  }

  return 'error';
}

function isSyntaxError(output: string, runtime: Runtime): boolean {
  const normalized = output.toLowerCase();

  if (runtime === 'python') {
    return (
      normalized.includes('syntaxerror') ||
      normalized.includes('invalid syntax') ||
      normalized.includes('indentationerror') ||
      normalized.includes('taberror')
    );
  }

  return (
    normalized.includes('syntaxerror') ||
    normalized.includes('unexpected token') ||
    normalized.includes('unexpected identifier') ||
    normalized.includes('parse error')
  );
}

function firstNonEmptyLine(text: string): string {
  const line = text
    .split('\n')
    .map(value => value.trim())
    .find(value => value.length > 0);

  return line || 'Invalid code.';
}

function withJsonHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'Content-Type': 'application/json',
  };
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(
      `Islo request failed (${response.status}): ${await safeReadText(response)}`
    );
  }

  return (await response.json()) as T;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text || '<empty response>';
  } catch {
    return '<failed to read response>';
  }
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('Islo API URL cannot be empty.');
  }

  try {
    new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid Islo API URL '${trimmed}'. Provide a full URL such as https://api.islo.dev.`
    );
  }

  return trimmed;
}

function defaultImageForRuntime(runtime: Runtime): string {
  return runtime === 'python' ? DEFAULT_PYTHON_IMAGE : DEFAULT_NODE_IMAGE;
}

function parseDateOrNow(value?: string | null): Date {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }

  if (typeof value === 'string') {
    if (!value.trim()) {
      return undefined;
    }

    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTokenFromAuthFile(authFilePath?: string): string | undefined {
  const resolvedAuthPath =
    asNonEmptyString(authFilePath) ||
    asNonEmptyString(process.env.ISLO_AUTH_FILE) ||
    resolvePath(homedir(), '.islo', 'auth.json');

  try {
    const raw = readFileSync(resolvedAuthPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return (
      asNonEmptyString(parsed.session_token) ||
      asNonEmptyString(parsed.access_token) ||
      asNonEmptyString(parsed.bearer_token)
    );
  } catch {
    return undefined;
  }
}

function createSandboxName(): string {
  return `islo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

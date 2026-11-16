/**
 * Cloudflare Provider - Factory-based Implementation (Dual-Mode)
 *
 * Supports two connection modes:
 *
 * 1. **Remote mode** — User deploys the bridge Worker in `worker/` (or the
 *    Cloudflare sandbox demo Worker), then connects from anywhere using
 *    sandboxUrl + sandboxApiKey.
 *
 * 2. **Direct mode** — User's code runs inside a Cloudflare Worker with a
 *    cross-script Durable Object binding to either Worker's Sandbox class.
 *
 * The mode is selected automatically based on which config fields are provided.
 * In remote mode, `GET /v1/info` tells the bridge apart from the demo Worker;
 * native files, preview URLs and snapshots are used only when it lists them.
 */

import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  RunCommandOptions,
  InstanceInfo,
} from '@computesdk/provider';

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 15 * 60_000;
// Each argv string stays under Linux's 128 KiB MAX_ARG_STRLEN once base64
// encoded; one exec carries several of them and stays well under ARG_MAX.
const WRITE_ARG_BYTES = 72 * 1024;
const WRITE_ARGS_PER_EXEC = 12;
const WRITE_EXEC_BYTES = WRITE_ARG_BYTES * WRITE_ARGS_PER_EXEC;
// Reads are split so no single exec output approaches the Durable Object RPC
// and Worker memory limits.
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const FILE_TRANSFER_CONCURRENCY = 4;

export interface CloudflareDirectExecOutput {
  stdout: ArrayBuffer;
  stderr: ArrayBuffer;
  exitCode: number;
}

/** Size and image of a new sandbox. The sandbox Worker uses its defaults for unset fields. */
export interface CloudflareSandboxOptions {
  /** vCPUs of a custom instance type. Set together with memoryMib and diskMb. */
  vcpu?: number;
  /** Memory of a custom instance type, in MiB. */
  memoryMib?: number;
  /** Disk of a custom instance type, in MB. */
  diskMb?: number;
  /** Name of an image declared by the sandbox Worker, for example `builder`. */
  image?: string;
  /** Snapshot to restore instead of an image. Bridge Worker only. */
  snapshotId?: string;
}

export interface CloudflareSandboxStub {
  start(options?: CloudflareSandboxOptions): Promise<void>;
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
  /** URL of the deployed bridge Worker (or Cloudflare sandbox demo Worker). */
  sandboxUrl?: string;
  /** API key that matches the Worker's SANDBOX_API_KEY secret. */
  sandboxApiKey?: string;
  /** @deprecated Use sandboxApiKey instead. */
  sandboxSecret?: string;
  /** Durable Object namespace of the Worker's Sandbox class. */
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

function sandboxOptions(
  options?: CreateInstanceOptions
): CloudflareSandboxOptions | undefined {
  const { vcpu, memoryMib, diskMb, image } = options ?? {};
  const selected: CloudflareSandboxOptions = Object.fromEntries(
    Object.entries({ vcpu, memoryMib, diskMb, image }).filter(
      ([, value]) => value !== undefined
    )
  );
  return Object.keys(selected).length > 0 ? selected : undefined;
}

async function createBridgeSandboxId(
  config: CloudflareConfig,
  options?: CloudflareSandboxOptions
): Promise<string> {
  const data = await bridgeJSONRequest(
    bridgeTarget(config),
    'POST',
    '/v1/sandbox',
    options
  );

  if (typeof data.id !== 'string' || !isBridgeSandboxId(data.id)) {
    throw new Error(
      'Sandbox Worker create failed: missing or invalid sandbox id'
    );
  }

  return data.id;
}

interface BridgeTarget {
  sandboxUrl?: string;
  sandboxApiKey?: string;
}

type BridgeFeature = 'files' | 'ports' | 'snapshots';

function bridgeUrl(target: BridgeTarget, path: string): string {
  const base = (target.sandboxUrl || '').replace(/\/$/, '');
  return `${base}${path}`;
}

function bridgeTarget(config: CloudflareConfig): BridgeTarget {
  return { sandboxUrl: config.sandboxUrl, sandboxApiKey: getSandboxApiKey(config) };
}

function bridgeFetch(
  target: BridgeTarget,
  method: string,
  path: string,
  body?: BodyInit,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(bridgeUrl(target, path), {
    method,
    headers: {
      Authorization: `Bearer ${target.sandboxApiKey || ''}`,
      ...headers,
    },
    body,
  });
}

const NO_BRIDGE_FEATURES: ReadonlySet<string> = new Set();
const bridgeFeatureCache = new Map<string, Promise<ReadonlySet<string>>>();

async function probeBridgeFeatures(target: BridgeTarget): Promise<ReadonlySet<string>> {
  const response = await bridgeFetch(target, 'GET', '/v1/info');
  // The Cloudflare sandbox demo Worker has no info route.
  if (response.status === 404) {
    await response.body?.cancel();
    return NO_BRIDGE_FEATURES;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Sandbox Worker info request failed: ${response.status}`);
  }
  const info = (await response.json().catch(() => null)) as {
    bridge?: unknown;
    features?: unknown;
  } | null;
  if (info?.bridge !== 'computesdk' || !Array.isArray(info.features)) {
    return NO_BRIDGE_FEATURES;
  }
  return new Set(info.features.filter((feature): feature is string => typeof feature === 'string'));
}

/** Whether the Worker at `target` serves `feature`. Failed probes are retried. */
async function hasBridgeFeature(target: BridgeTarget, feature: BridgeFeature): Promise<boolean> {
  if (!target.sandboxUrl) return false;
  const key = `${target.sandboxUrl.replace(/\/$/, '')}\n${target.sandboxApiKey ?? ''}`;
  let features = bridgeFeatureCache.get(key);
  if (!features) {
    features = probeBridgeFeatures(target);
    bridgeFeatureCache.set(key, features);
    features.catch(() => bridgeFeatureCache.delete(key));
  }
  try {
    return (await features).has(feature);
  } catch {
    return false;
  }
}

async function requireBridgeFeature(
  config: CloudflareConfig,
  feature: BridgeFeature,
  description: string
): Promise<BridgeTarget> {
  const target = bridgeTarget(config);
  if (!isRemote(config) || !(await hasBridgeFeature(target, feature))) {
    throw new Error(
      `Cloudflare ${description} need the ComputeSDK bridge Worker (run npx computesdk-cloudflare for deploy steps)`
    );
  }
  return target;
}

async function bridgeRequest(
  target: BridgeTarget,
  method: string,
  path: string,
  body?: BodyInit,
  headers: Record<string, string> = {}
): Promise<Response> {
  const response = await bridgeFetch(target, method, path, body, headers);

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
  cfSandbox: BridgeTarget,
  method: string,
  path: string,
  body?: object
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

interface RawExecOutput {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
}

function parseBridgeExecBytes(text: string): RawExecOutput {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
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
      stdout.push(Buffer.from(payload, 'base64'));
    } else if (event === 'stderr') {
      stderr.push(Buffer.from(payload, 'base64'));
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
      let message = payload;
      try {
        const parsed = JSON.parse(payload);
        message = parsed.error || parsed.message || payload;
      } catch {
        // keep the raw payload
      }
      stderr.push(Buffer.from(String(message)));
      exitCode ??= 1;
    }
  }

  if (exitCode === undefined) {
    throw new Error('Sandbox Worker exec response ended without an exit event');
  }
  return {
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr).toString('utf8'),
    exitCode,
  };
}

function parseBridgeExecEvents(
  text: string
): Pick<CommandResult, 'stdout' | 'stderr' | 'exitCode'> {
  const { stdout, stderr, exitCode } = parseBridgeExecBytes(text);
  return { stdout: Buffer.from(stdout).toString('utf8'), stderr, exitCode };
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

async function execArgv(
  cfSandbox: CloudflareSandbox,
  argv: string[]
): Promise<RawExecOutput> {
  const timeoutMs = executionTimeout(cfSandbox.timeoutMs);
  if (cfSandbox.remote) {
    const response = await bridgeRequest(
      cfSandbox,
      'POST',
      `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/exec`,
      JSON.stringify({ argv, timeout_ms: timeoutMs }),
      { 'Content-Type': 'application/json' }
    );
    return parseBridgeExecBytes(await response.text());
  }

  if (!cfSandbox.sandbox) throw new Error('Missing Cloudflare sandbox binding');
  const output = await cfSandbox.sandbox.exec(argv, undefined, timeoutMs);
  return {
    stdout: new Uint8Array(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    exitCode: output.exitCode,
  };
}

function assertRawSucceeded(result: RawExecOutput, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${action} failed: ${result.stderr || `exit ${result.exitCode}`}`
    );
  }
}

async function runPool<T>(
  items: T[],
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(FILE_TRANSFER_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) await worker(items[next++]);
    }
  );
  await Promise.all(runners);
}

const READ_FIRST_SCRIPT = `stat -c %s -- "$0" && dd if="$0" bs=1M iflag=count_bytes count="$1" status=none`;
const READ_RANGE_SCRIPT = `dd if="$0" bs=1M iflag=skip_bytes,count_bytes skip="$1" count="$2" status=none`;
const WRITE_RANGE_SCRIPT = `p=$0; o=$1; shift; printf %s "$@" | base64 -d | dd of="$p" bs=1M iflag=fullblock oflag=seek_bytes seek="$o" conv=notrunc status=none`;

async function readFileBytes(
  cfSandbox: CloudflareSandbox,
  path: string
): Promise<Buffer> {
  const first = await execArgv(cfSandbox, [
    'sh',
    '-c',
    READ_FIRST_SCRIPT,
    path,
    String(READ_CHUNK_BYTES),
  ]);
  assertRawSucceeded(first, 'File read');

  const newline = first.stdout.indexOf(10);
  const size = Number.parseInt(
    Buffer.from(first.stdout.subarray(0, newline)).toString('utf8'),
    10
  );
  if (newline < 0 || !Number.isFinite(size)) {
    throw new Error('File read failed: malformed size output');
  }

  const head = Buffer.from(first.stdout.subarray(newline + 1));
  if (head.length < READ_CHUNK_BYTES || size <= READ_CHUNK_BYTES) return head;

  const offsets: number[] = [];
  for (let offset = READ_CHUNK_BYTES; offset < size; offset += READ_CHUNK_BYTES) {
    offsets.push(offset);
  }
  const chunks = new Map<number, Uint8Array>();
  await runPool(offsets, async (offset) => {
    const result = await execArgv(cfSandbox, [
      'sh',
      '-c',
      READ_RANGE_SCRIPT,
      path,
      String(offset),
      String(Math.min(READ_CHUNK_BYTES, size - offset)),
    ]);
    assertRawSucceeded(result, 'File read');
    chunks.set(offset, result.stdout);
  });

  return Buffer.concat([head, ...offsets.map((offset) => chunks.get(offset)!)]);
}

async function writeRange(
  cfSandbox: CloudflareSandbox,
  tempPath: string,
  bytes: Uint8Array,
  offset: number
): Promise<void> {
  const end = Math.min(offset + WRITE_EXEC_BYTES, bytes.length);
  const encoded: string[] = [];
  for (let start = offset; start < end; start += WRITE_ARG_BYTES) {
    encoded.push(
      Buffer.from(
        bytes.subarray(start, Math.min(start + WRITE_ARG_BYTES, end))
      ).toString('base64')
    );
  }
  const result = await execArgv(cfSandbox, [
    'sh',
    '-c',
    WRITE_RANGE_SCRIPT,
    tempPath,
    String(offset),
    ...encoded,
  ]);
  assertRawSucceeded(result, 'File write');
}

function assertCommandSucceeded(result: CommandResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${action} failed: ${result.stderr || `exit ${result.exitCode}`}`
    );
  }
}

async function usesNativeFiles(cfSandbox: CloudflareSandbox, path: string): Promise<boolean> {
  return cfSandbox.remote && path.startsWith('/') && (await hasBridgeFeature(cfSandbox, 'files'));
}

function filesRoute(cfSandbox: CloudflareSandbox, route: string, path: string): string {
  return `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/${route}?path=${encodeURIComponent(path)}`;
}

interface BridgeFileEntry {
  name: string;
  type: string;
  size: number;
  modifiedAt: string;
}

function toFileEntry(entry: BridgeFileEntry): FileEntry {
  return {
    name: entry.name,
    type: entry.type === 'directory' ? 'directory' : 'file',
    size: entry.size,
    modified: new Date(entry.modifiedAt),
  };
}

export interface CloudflareSnapshot {
  id: string;
  name: string | null;
  size: number;
  sandboxId: string;
  createdAt: Date;
}

function toSnapshot(record: Record<string, any>): CloudflareSnapshot {
  if (typeof record.id !== 'string' || record.id === '') {
    throw new Error('Sandbox Worker snapshot response is missing an id');
  }
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : null,
    size: Number(record.size ?? 0),
    sandboxId: String(record.sandboxId ?? ''),
    createdAt: new Date(record.createdAt ?? Date.now()),
  };
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
    instances: {
      create: async (
        config: CloudflareConfig,
        options?: CreateInstanceOptions
      ) => {
        const envVars = { ...config.envVars, ...options?.envs };
        const timeoutMs = executionTimeout(
          config.timeout ?? DEFAULT_EXEC_TIMEOUT_MS
        );
        const startOptions = sandboxOptions(options);

        if (options?.snapshotId !== undefined && !options.sandboxId) {
          await requireBridgeFeature(config, 'snapshots', 'snapshots');
        }

        if (isRemote(config)) {
          const sandboxId =
            options?.sandboxId ||
            (await createBridgeSandboxId(
              config,
              options?.snapshotId === undefined
                ? startOptions
                : { ...startOptions, snapshotId: options.snapshotId }
            ));
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
          await sandbox.start(startOptions);
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
            return result.exitCode === 0 ? { instance: sandbox, instanceId: sandboxId } : null;
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
          await bridgeJSONRequest(
            bridgeTarget(config),
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

      getInfo: async (cfSandbox: CloudflareSandbox): Promise<InstanceInfo> => {
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

      getUrl: async (
        cfSandbox: CloudflareSandbox,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        if (!cfSandbox.remote || !(await hasBridgeFeature(cfSandbox, 'ports'))) {
          throw new Error(
            'Cloudflare sandbox Worker does not support port forwarding'
          );
        }
        const { port } = options;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new RangeError(`Invalid port: ${port}`);
        }
        const url = new URL(
          bridgeUrl(cfSandbox, `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/ports/${port}/`)
        );
        const protocol = options.protocol?.replace(/:$/, '');
        if (protocol === 'ws' || protocol === 'wss') {
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        }
        return url.toString();
      },

      filesystem: {
        readFile: async (cfSandbox: CloudflareSandbox, path: string) => {
          if (await usesNativeFiles(cfSandbox, path)) {
            const response = await bridgeRequest(cfSandbox, 'GET', filesRoute(cfSandbox, 'files', path));
            return await response.text();
          }
          return (await readFileBytes(cfSandbox, path)).toString('utf8');
        },

        writeFile: async (
          cfSandbox: CloudflareSandbox,
          path: string,
          content: string
        ): Promise<void> => {
          if (await usesNativeFiles(cfSandbox, path)) {
            await bridgeRequest(
              cfSandbox,
              'PUT',
              filesRoute(cfSandbox, 'files', path),
              new TextEncoder().encode(content),
              { 'Content-Type': 'application/octet-stream' }
            );
            return;
          }
          const tempPath = `/tmp/.computesdk-${crypto.randomUUID()}`;
          try {
            let result = await exec(cfSandbox, `: > ${shellQuote(tempPath)}`);
            assertCommandSucceeded(result, 'Temporary file creation');

            const bytes = new TextEncoder().encode(content);
            const offsets: number[] = [];
            for (
              let offset = 0;
              offset < bytes.length;
              offset += WRITE_EXEC_BYTES
            ) {
              offsets.push(offset);
            }
            await runPool(offsets, (offset) =>
              writeRange(cfSandbox, tempPath, bytes, offset)
            );

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
          if (await usesNativeFiles(cfSandbox, path)) {
            await bridgeRequest(cfSandbox, 'POST', filesRoute(cfSandbox, 'files/mkdir', path));
            return;
          }
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
          if (await usesNativeFiles(cfSandbox, path)) {
            const { entries } = await bridgeJSONRequest(
              cfSandbox,
              'GET',
              filesRoute(cfSandbox, 'files/list', path)
            );
            return (entries as BridgeFileEntry[]).map(toFileEntry);
          }
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
          if (await usesNativeFiles(cfSandbox, path)) {
            const response = await bridgeFetch(cfSandbox, 'GET', filesRoute(cfSandbox, 'files/stat', path));
            await response.body?.cancel();
            if (response.status === 404) return false;
            if (!response.ok) throw new Error(`Sandbox Worker request failed: ${response.status}`);
            return true;
          }
          const result = await exec(cfSandbox, `test -e ${shellQuote(path)}`);
          return result.exitCode === 0;
        },

        remove: async (
          cfSandbox: CloudflareSandbox,
          path: string
        ): Promise<void> => {
          if (await usesNativeFiles(cfSandbox, path)) {
            await bridgeRequest(cfSandbox, 'DELETE', filesRoute(cfSandbox, 'files', path));
            return;
          }
          const result = await exec(cfSandbox, `rm -rf -- ${shellQuote(path)}`);
          assertCommandSucceeded(result, 'File removal');
        },
      },
    },

    snapshot: {
      create: async (
        config: CloudflareConfig,
        instanceId: string,
        options?: { name?: string }
      ): Promise<CloudflareSnapshot> => {
        const target = await requireBridgeFeature(config, 'snapshots', 'snapshots');
        const record = await bridgeJSONRequest(
          target,
          'POST',
          `/v1/sandbox/${encodeURIComponent(instanceId)}/snapshot`,
          options?.name ? { name: options.name } : {}
        );
        return toSnapshot(record);
      },

      list: async (
        config: CloudflareConfig,
        options?: { instanceId?: string; limit?: number }
      ): Promise<CloudflareSnapshot[]> => {
        const target = await requireBridgeFeature(config, 'snapshots', 'snapshots');
        const { snapshots } = await bridgeJSONRequest(target, 'GET', '/v1/snapshots');
        const all = (snapshots as Record<string, any>[]).map(toSnapshot);
        const filtered = options?.instanceId
          ? all.filter((snapshot) => snapshot.sandboxId === options.instanceId)
          : all;
        return options?.limit === undefined ? filtered : filtered.slice(0, options.limit);
      },

      // Cloudflare keeps snapshot data until 30 days after its last restore;
      // deleting removes the handle, so the bridge no longer restores it.
      delete: async (config: CloudflareConfig, snapshotId: string): Promise<void> => {
        const target = await requireBridgeFeature(config, 'snapshots', 'snapshots');
        await bridgeRequest(target, 'DELETE', `/v1/snapshots/${encodeURIComponent(snapshotId)}`);
      },
    },
  },
});

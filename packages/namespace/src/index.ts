/**
 * Namespace Provider
 *
 * Full-featured provider using the factory pattern.
 * Supports instance lifecycle management and command execution via Namespace Compute API.
 */

import * as fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { defineProvider, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle, InstanceSizeError, TIMEOUT_EXIT_CODE, START_FAILURE_EXIT_CODE } from '@computesdk/provider';
import type { CommandResult, InstanceInfo, CreateInstanceOptions, CreateSnapshotOptions, RunCommandOptions, ListSnapshotsOptions } from '@computesdk/provider';

/**
 * Namespace sandbox instance
 */
export interface NamespaceSandbox {
  instanceId: string;
  name: string;
  commandServiceEndpoint?: string;
  token: string;
  targetContainerName: string;
  createdAt: Date;
  /** Instance lifecycle state from InstanceMetadata.status, lowercased (e.g. 'running', 'destroying'). */
  status?: string;
  /**
   * Container path of the snapshot volume (opt-in `snapshotVolume`, or a
   * `snapshotId` restore). Commands default to it as their cwd.
   */
  snapshotVolumeMountPoint?: string;
}

/** Opt-in persistent volume that makes a sandbox snapshot-capable. */
export interface NamespaceSnapshotVolumeOptions {
  /** Container path the volume is mounted at; also the default cwd (default: /workspace). */
  mountPath?: string;
  /** Volume size in MB (default: 1024). */
  sizeMb?: number;
}

/**
 * Proto enum values of InstanceMetadata.Status that mean the instance is gone
 * or going away. JSON transcoding emits the enum either as its name
 * ('DESTROYED') or its number (4 = DESTROYED, 5 = DESTROYING).
 */
const GONE_INSTANCE_STATUSES = new Set<string | number>(['DESTROYED', 'DESTROYING', 4, 5]);

/** InstanceMetadata.Status names by proto number, for numeric encodings. */
const INSTANCE_STATUS_NAMES: Record<number, string> = {
  1: 'pending',
  2: 'creating',
  3: 'running',
  4: 'destroyed',
  5: 'destroying',
  6: 'suspending',
  7: 'suspended',
  8: 'error',
};

function instanceStatus(
  metadata: { status?: string | number } | undefined,
): string | undefined {
  const status = metadata?.status;
  if (typeof status === 'string') return status.toLowerCase();
  if (typeof status === 'number') return INSTANCE_STATUS_NAMES[status] ?? 'unknown';
  return undefined;
}

function isGoneInstance(
  metadata: { status?: string | number } | undefined,
): boolean {
  return metadata?.status !== undefined && GONE_INSTANCE_STATUSES.has(metadata.status);
}

/**
 * Raw Namespace API fields passed through on create (snake_case, as in
 * CreateInstanceRequest / ContainerRequest). Fields the provider sets itself
 * take precedence.
 */
function plainObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The image is chosen by `image`; a passthrough selector would conflict. */
function withoutImageSelector(fields: Record<string, unknown>): Record<string, unknown> {
  const { image_ref: _imageRef, known_image_id: _knownImageId, ...rest } = fields;
  return rest;
}

/**
 * Namespace provider configuration
 */
export interface NamespaceConfig {
  /** Namespace API token - if not provided, will fallback to NSC_TOKEN environment variable */
  token?: string;
  /** Path to a JSON token file (e.g. from `nsc login`) containing bearer_token - fallback to NSC_TOKEN_FILE */
  tokenFile?: string;
  /** Virtual CPU cores for the instance */
  virtualCpu?: number;
  /** Memory in megabytes for the instance */
  memoryMegabytes?: number;
  /** Machine architecture (default: amd64) */
  machineArch?: string;
  /** Operating system (default: linux) */
  os?: string;
  /** Documented purpose for the instance */
  documentedPurpose?: string;
  /** Reason for destroying instances (default: "ComputeSDK cleanup") */
  destroyReason?: string;
  /** Target container name for command execution (default: "main-container") */
  targetContainerName?: string;
  /**
   * Attach a persistent volume to every sandbox so `snapshot.create` works.
   * Only the volume's contents are snapshotted, never the rootfs. Can also be
   * passed per create as `create({ snapshotVolume })`.
   */
  snapshotVolume?: boolean | NamespaceSnapshotVolumeOptions;
  /** How long `snapshot.create` waits for the volume snapshot to commit (default: 300000). */
  snapshotTimeoutMs?: number;
}

const API_ENDPOINTS = {
  CREATE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/CreateInstance',
  DESCRIBE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance',
  LIST_INSTANCES: '/namespace.cloud.compute.v1beta.ComputeService/ListInstances',
  DESTROY_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DestroyInstance'
};

const COMMAND_SERVICE = {
  RUN_COMMAND_SYNC: '/namespace.cloud.compute.v1beta.CommandService/RunCommandSync',
  RUN_COMMAND: '/namespace.cloud.compute.v1beta.CommandService/RunCommand',
};

const STORAGE_SERVICE = {
  LIST_PERSISTENT_VOLUMES: '/namespace.cloud.compute.v1beta.StorageService/ListPersistentVolumes',
  DESCRIBE_PERSISTENT_VOLUME: '/namespace.cloud.compute.v1beta.StorageService/DescribePersistentVolume',
  DESTROY_PERSISTENT_VOLUMES: '/namespace.cloud.compute.v1beta.StorageService/DestroyPersistentVolumes',
  LIST_PERSISTENT_VOLUME_SNAPSHOTS: '/namespace.cloud.compute.v1beta.StorageService/ListPersistentVolumeSnapshots',
  DESTROY_PERSISTENT_VOLUME_SNAPSHOT: '/namespace.cloud.compute.v1beta.StorageService/DestroyPersistentVolumeSnapshot',
};

interface WireVolume {
  id: string;
  tag?: string;
  site?: string;
}

/** A snapshot record — the API answers JSON in camelCase (snake accepted too). */
interface WireSnapshotRecord {
  /** The VOLUME id the snapshot belongs to — not the generation. */
  id?: string;
  completedSnapshot?: string;
  completed_snapshot?: string;
  attachedInstanceId?: string;
  attached_instance_id?: string;
  createdAt?: string;
  created_at?: string;
  abandonedAt?: string;
  abandoned_at?: string;
  releasedAt?: string;
  released_at?: string;
  /** The volume this one was seeded from (`from_snapshot_id`). */
  snapshotFrom?: string;
  snapshot_from?: string;
}

function snapshotReleasedAt(snap: WireSnapshotRecord): string | undefined {
  return snap.releasedAt || snap.released_at || undefined;
}

function snapshotParent(snap: WireSnapshotRecord): string | undefined {
  return snap.snapshotFrom || snap.snapshot_from || undefined;
}

function isAbandoned(snap: WireSnapshotRecord): boolean {
  return Boolean(snap.abandonedAt || snap.abandoned_at);
}

function snapshotGeneration(snap: WireSnapshotRecord): string | undefined {
  return snap.completedSnapshot || snap.completed_snapshot || undefined;
}

function snapshotAttachedInstance(snap: WireSnapshotRecord): string | undefined {
  return snap.attachedInstanceId || snap.attached_instance_id || undefined;
}

async function listPersistentVolumes(token: string): Promise<WireVolume[]> {
  const volumes: WireVolume[] = [];
  let cursor: string | undefined;
  do {
    const response = await fetchNamespace(token, STORAGE_SERVICE.LIST_PERSISTENT_VOLUMES, {
      method: 'POST',
      body: JSON.stringify(cursor ? { pagination_cursor: cursor } : {})
    });
    volumes.push(...(response.volumes || []));
    cursor = response.pagination_cursor || undefined;
  } while (cursor);
  return volumes;
}

async function listVolumeSnapshotRecords(token: string, tag?: string): Promise<WireSnapshotRecord[]> {
  const records: WireSnapshotRecord[] = [];
  let cursor: string | undefined;
  do {
    const response = await fetchNamespace(token, STORAGE_SERVICE.LIST_PERSISTENT_VOLUME_SNAPSHOTS, {
      method: 'POST',
      body: JSON.stringify({ ...(tag && { tag }), ...(cursor && { pagination_cursor: cursor }) })
    });
    records.push(...(response.snapshots || []));
    cursor = response.pagination_cursor || undefined;
  } while (cursor);
  return records;
}

/**
 * Snapshot volumes: a PERSISTENT volume is snapshotted by Namespace when its
 * instance shuts down, and `from_snapshot_id: <volumeId>` seeds a new volume
 * from that snapshot — but only within the same tag (the API resolves it as
 * `<tag>/<volumeId>`), so restores reuse the source tag. SDK snapshot ids are
 * that same `<tag>/<volumeId>` reference.
 */
const SNAPSHOT_VOLUME_HOST_PATH = `/volumes/computesdk-snapshot`;
const DEFAULT_SNAPSHOT_MOUNT_PATH = '/workspace';
/** Instance label carrying the snapshot volume's tag. */
const SNAPSHOT_TAG_LABEL = 'computesdk-snapshot-tag';
/** Instance label carrying the container mount path (base64url — labels are tag-like strings). */
const SNAPSHOT_MOUNT_LABEL = 'computesdk-snapshot-mount';
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 5 * 60 * 1000;
const SNAPSHOT_POLL_INTERVAL_MS = 1000;

interface WireLabel { name?: string; value?: string }

function labelValue(labels: WireLabel[] | undefined, name: string): string | undefined {
  return (labels || []).find((l) => l?.name === name)?.value || undefined;
}

/** Container path of an instance's snapshot volume, recovered from its labels. */
function snapshotMountFromLabels(labels: WireLabel[] | undefined): string | undefined {
  if (!labelValue(labels, SNAPSHOT_TAG_LABEL)) return undefined;
  const encoded = labelValue(labels, SNAPSHOT_MOUNT_LABEL);
  if (!encoded) return DEFAULT_SNAPSHOT_MOUNT_PATH;
  try { return Buffer.from(encoded, 'base64url').toString() || DEFAULT_SNAPSHOT_MOUNT_PATH; } catch { return DEFAULT_SNAPSHOT_MOUNT_PATH; }
}

/** Splits an SDK snapshot id `<tag>/<volumeId>`. */
export function parseNamespaceSnapshotId(snapshotId: string): { tag: string; volumeId: string } {
  const slash = snapshotId.lastIndexOf('/');
  if (slash <= 0 || slash === snapshotId.length - 1) {
    throw new Error(`Invalid Namespace snapshot id "${snapshotId}": expected "<volumeTag>/<volumeId>" as returned by snapshot.create`);
  }
  return { tag: snapshotId.slice(0, slash), volumeId: snapshotId.slice(slash + 1) };
}

function resolveSnapshotVolumeOptions(
  value: unknown,
): NamespaceSnapshotVolumeOptions | undefined {
  if (value === true) return {};
  if (value && typeof value === 'object') return value as NamespaceSnapshotVolumeOptions;
  return undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Size and cell of a (released) source volume. A restore must request at
 * least its size, and land in its cell — volumes are cell-local, and a
 * restore placed elsewhere fails with `<tag>/<volumeId> does not exist`.
 */
async function describeSourceVolume(token: string, volumeId: string, tag: string): Promise<{ sizeMb?: number; cell?: string }> {
  try {
    const response = await fetchNamespace(token, STORAGE_SERVICE.DESCRIBE_PERSISTENT_VOLUME, {
      method: 'POST',
      body: JSON.stringify({ id: volumeId, tag }),
    });
    const size = Number(response?.volume?.sizeMb ?? response?.volume?.size_mb);
    // `site` is the cell's host, e.g. `iad3-a.nscluster.cloud`.
    const site = response?.volume?.site;
    return {
      ...(Number.isFinite(size) && size > 0 && { sizeMb: size }),
      ...(typeof site === 'string' && site !== '' && { cell: site.split('.')[0] }),
    };
  } catch {
    return {};
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

/** Defaults a command's cwd to the sandbox's snapshot volume. */
function withDefaultCwd(sandbox: NamespaceSandbox, options?: RunCommandOptions): RunCommandOptions | undefined {
  if (!sandbox.snapshotVolumeMountPoint || options?.cwd) return options;
  return { ...options, cwd: sandbox.snapshotVolumeMountPoint };
}

/**
 * Size requested for runtime-attached persistent volumes. `VolumeRequest`
 * carries `size_mb`: snapshot-seeded volumes inherit capacity from
 * `from_snapshot_id`, but a fresh persistent volume with no size cannot be
 * provisioned — the instance is destroyed while waiting for readiness.
 */
const RUNTIME_VOLUME_SIZE_MB = 1024;

/**
 * VM-level mount root for runtime-attached volumes. Volumes attach to the
 * instance's VM namespace only — a container sees them through a
 * `host_mount` bind (the recipe nsc's `cluster run --volume` uses:
 * volume at /volumes/volumeN + bind into the container at the requested
 * path). Mounting the block device directly at the container path leaves
 * it invisible to the CommandService container — and instances whose
 * volumes can't provision are destroyed while waiting for readiness.
 */
const VOLUME_HOST_ROOT = '/volumes';

/**
 * Load bearer token from a JSON token file (e.g. from `nsc login`)
 */
async function loadTokenFromFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8');
  const tokenJson: { bearer_token?: string } = JSON.parse(content);
  if (!tokenJson.bearer_token) {
    throw new Error(`Token file ${filePath} does not contain a bearer_token`);
  }
  return tokenJson.bearer_token;
}

/**
 * Get and validate Namespace credentials from config and environment.
 */
export const getAndValidateCredentials = async (config: NamespaceConfig) => {
  let token = config.token || (typeof process !== 'undefined' && process.env?.NSC_TOKEN) || '';

  if (!token) {
    const tokenFile = config.tokenFile || (typeof process !== 'undefined' && process.env?.NSC_TOKEN_FILE) || '';
    if (tokenFile) {
      token = await loadTokenFromFile(tokenFile);
    }
  }

  if (!token) {
    throw new Error(
      'Missing Namespace token. Provide token in config, set NSC_TOKEN, or set NSC_TOKEN_FILE environment variable (or provide tokenFile in config).'
    );
  }

  return { token };
};

const handleApiErrors = (response: any) => {
  if (response.error) {
    throw new Error(`Namespace API error: ${response.error}`);
  }
};

/** Calls that are safe to repeat: reads, and destroys (a second destroy is a no-op). */
const IDEMPOTENT_ENDPOINTS = new Set<string>([
  API_ENDPOINTS.DESCRIBE_INSTANCE,
  API_ENDPOINTS.LIST_INSTANCES,
  API_ENDPOINTS.DESTROY_INSTANCE,
  STORAGE_SERVICE.LIST_PERSISTENT_VOLUMES,
  STORAGE_SERVICE.LIST_PERSISTENT_VOLUME_SNAPSHOTS,
  STORAGE_SERVICE.DESTROY_PERSISTENT_VOLUME_SNAPSHOT,
]);

/** Connection failures that mean the request never reached Namespace. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

const RETRY_DELAYS_MS = [250, 1000];

/**
 * Whether a failed attempt may be repeated. Any call retries a connection
 * that never opened; a 5xx (even 503 — a gateway may have forwarded it) or a
 * mid-request drop retries only idempotent calls, since a command or a create
 * may already have run.
 */
function retryable(endpoint: string, failure: { status: number } | { error: unknown }): boolean {
  const idempotent = IDEMPOTENT_ENDPOINTS.has(endpoint);
  if ('status' in failure) return idempotent && failure.status >= 500;
  const code = (failure.error as { cause?: { code?: string } })?.cause?.code;
  return idempotent || (code !== undefined && NOT_SENT_CODES.has(code));
}

/** Namespace's error body (Connect JSON `{code, message}`), for the thrown message. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return '';
    try {
      const body = JSON.parse(text) as { code?: string; message?: string };
      const detail = [body.code, body.message].filter(Boolean).join(': ');
      if (detail) return `: ${detail}`;
    } catch {
      // not JSON — fall through to the raw text
    }
    return `: ${text.slice(0, 300)}`;
  } catch {
    return '';
  }
}

/** Whether a `fetchNamespace` error is Namespace's 404, not a 404 in some other error's text. */
export const isNamespaceNotFound = (error: unknown): boolean =>
  (error as { status?: unknown } | null)?.status === 404 ||
  (error instanceof Error && error.message.startsWith('Namespace API error: 404'));

export const fetchNamespace = async (
  token: string,
  endpoint: string,
  options: RequestInit = {},
  baseUrl: string = 'https://us.compute.namespaceapis.com'
) => {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];
    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...options.headers
        }
      });
    } catch (error) {
      if (delay !== undefined && retryable(endpoint, { error })) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
    if (response.ok) break;
    if (delay !== undefined && retryable(endpoint, { status: response.status })) {
      // An unread body keeps its connection out of the pool.
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    throw Object.assign(
      new Error(`Namespace API error: ${response.status} ${response.statusText}${await errorDetail(response)}`),
      { status: response.status }
    );
  }

  const data = await response.json();
  handleApiErrors(data);
  return data;
};

/** CommandService's `Command`: argv plus the env and working directory it runs with. */
interface WireCommand {
  command: string[];
  envVars?: { name: string; value: string }[];
  cwd?: string;
}

/**
 * `command` as a CommandService `Command`. Env and cwd go in the request's own
 * fields, so they apply to the whole command line (`echo $FOO`, `a && b`), not
 * just its first word; background runs the line detached under `nohup sh -c`.
 */
function wireCommand(command: string, options?: RunCommandOptions): WireCommand {
  const line = options?.background
    ? `nohup sh -c '${command.replace(/'/g, `'\\''`)}' > /dev/null 2>&1 &`
    : command;
  return {
    command: ['sh', '-c', line],
    ...(options?.env && Object.keys(options.env).length > 0
      ? { envVars: Object.entries(options.env).map(([name, value]) => ({ name, value: String(value) })) }
      : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  };
}

function commandTimeoutMs(options?: RunCommandOptions): number | undefined {
  return typeof options?.timeout === 'number' &&
    Number.isFinite(options.timeout) &&
    options.timeout > 0
    ? Math.floor(options.timeout)
    : undefined;
}

/** One `RunCommandResponse` (or end-of-stream message) in Connect JSON; `data` is base64. */
interface WireRunCommandMessage {
  stream?: 'STDOUT' | 'STDERR' | 'STREAM_UNKNOWN' | number;
  data?: string;
  exitStatus?: { exitCode?: number };
  error?: { code?: string; message?: string };
}

const CONNECT_FLAG_END_STREAM = 0x02;

/**
 * Namespace reports every failing command as exit code 1 and puts the real
 * code in a final stderr line from its exec agent, e.g.
 * `time="..." level=fatal msg="exec failed with exit code 3"`.
 */
const EXEC_FAILED_LINE = /(^|\n)time="[^"\n]*" level=fatal msg="exec failed with exit code (-?\d+)"\n?$/;

/** Strips Namespace's exec-failure line from `stderr` and returns the command's real exit code. */
function realExitStatus(stderr: string, exitCode: number): { stderr: string; exitCode: number } {
  const match = exitCode === 1 ? EXEC_FAILED_LINE.exec(stderr) : null;
  if (!match) return { stderr, exitCode };
  return { stderr: stderr.slice(0, match.index + match[1].length), exitCode: Number(match[2]) };
}

/** Splits a Connect streaming body into frames: 1 flag byte, 4-byte big-endian length, JSON payload. */
async function* connectFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ flags: number; message: WireRunCommandMessage }> {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  for (;;) {
    while (buffer.length >= 5) {
      const length = new DataView(buffer.buffer, buffer.byteOffset, 5).getUint32(1);
      if (buffer.length < 5 + length) break;
      yield { flags: buffer[0], message: JSON.parse(new TextDecoder().decode(buffer.subarray(5, 5 + length))) };
      buffer = buffer.subarray(5 + length);
    }
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.length > 0) throw new Error('stream ended inside a frame');
      return;
    }
    const next = new Uint8Array(buffer.length + value.length);
    next.set(buffer);
    next.set(value, buffer.length);
    buffer = next;
  }
}

/**
 * Streams `command` over CommandService.RunCommand. Exit codes follow the
 * other native streamers: timeout 124, failure before any output 127, stream
 * lost before its exit status -1 (RunCommand has no way to recover it).
 */
async function streamNamespaceCommand(sandbox: NamespaceSandbox, command: WireCommand, options: RunCommandOptions): Promise<CommandResult> {
  const startTime = Date.now();
  const timeoutMs = commandTimeoutMs(options);
  const controller = new AbortController();
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;
  let execFailure: string | undefined;
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  // Called without bytes, flushes a multi-byte character split across chunks.
  const emit = (stream: 'stdout' | 'stderr', bytes?: Uint8Array) => {
    const text = decoders[stream].decode(bytes, { stream: bytes !== undefined });
    if (!text) return;
    if (stream === 'stderr') {
      // Held back until the exit status shows whether it is Namespace's exec-failure line.
      if (execFailure !== undefined) {
        stderr += execFailure;
        options.onStderr?.(execFailure);
        execFailure = undefined;
      }
      if (EXEC_FAILED_LINE.test(text) && realExitStatus(text, 1).stderr === '') {
        execFailure = text;
        return;
      }
      stderr += text;
      options.onStderr?.(text);
    } else {
      stdout += text;
      options.onStdout?.(text);
    }
  };

  try {
    const body = new TextEncoder().encode(JSON.stringify({
      instanceId: sandbox.instanceId,
      targetContainerName: sandbox.targetContainerName,
      command,
    }));
    const envelope = new Uint8Array(5 + body.length);
    new DataView(envelope.buffer).setUint32(1, body.length);
    envelope.set(body, 5);

    const response = await fetch(`${sandbox.commandServiceEndpoint}${COMMAND_SERVICE.RUN_COMMAND}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/connect+json',
        'Connect-Protocol-Version': '1',
        'Authorization': `Bearer ${sandbox.token}`,
        ...(timeoutMs !== undefined ? { 'Connect-Timeout-Ms': String(timeoutMs) } : {}),
      },
      body: envelope,
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Namespace API error: ${response.status} ${response.statusText}${await errorDetail(response)}`);
    }

    for await (const { flags, message } of connectFrames(response.body)) {
      if (flags & CONNECT_FLAG_END_STREAM) {
        if (message.error) throw new Error(`Namespace API error: ${[message.error.code, message.error.message].filter(Boolean).join(': ')}`);
        break;
      }
      if (message.data) emit(message.stream === 'STDERR' || message.stream === 2 ? 'stderr' : 'stdout', Buffer.from(message.data, 'base64'));
      if (message.exitStatus) exitCode = message.exitStatus.exitCode ?? 0;
    }
    if (exitCode === undefined) throw new Error('Namespace command stream ended without an exit status');
  } catch (error) {
    emit('stdout');
    emit('stderr');
    const reason = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted || (timeoutMs !== undefined && reason.includes('deadline_exceeded'))) {
      exitCode = TIMEOUT_EXIT_CODE;
    } else if (exitCode === undefined) {
      exitCode = stdout || stderr ? -1 : START_FAILURE_EXIT_CODE;
      const text = `${stderr && !stderr.endsWith('\n') ? '\n' : ''}${reason}`;
      stderr += text;
      options.onStderr?.(text);
    }
  } finally {
    clearTimeout(timer);
  }
  emit('stdout');
  emit('stderr');
  if (execFailure !== undefined) {
    if (exitCode === 1) {
      exitCode = realExitStatus(execFailure, 1).exitCode;
    } else {
      stderr += execFailure;
      options.onStderr?.(execFailure);
    }
  }
  return { stdout, stderr, exitCode, durationMs: Date.now() - startTime };
}

/**
 * Namespace provider
 *
 * Creates Namespace instances and supports command execution via CommandService.
 */
export const namespace = defineProvider<NamespaceSandbox, NamespaceConfig>({
  name: 'namespace',
  sizes: (config, profile, options) => {
    for (const [field, value] of [['instanceOptions', options?.instanceOptions], ['instanceOptions.shape', options?.instanceOptions?.shape]] as const) {
      if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        throw new InstanceSizeError('invalid', `${field} must be an object when requesting sizeClass`);
      }
    }
    const instanceOptions = plainObject(options?.instanceOptions);
    const shape = plainObject(instanceOptions.shape);
    if (shape.virtual_cpu !== undefined || shape.memory_megabytes !== undefined ||
        shape.virtualCpu !== undefined || shape.memoryMegabytes !== undefined ||
        options?.virtualCpu !== undefined || options?.memoryMegabytes !== undefined ||
        options?.virtual_cpu !== undefined || options?.memory_megabytes !== undefined) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with instanceOptions.shape CPU/memory');
    }
    for (const field of ['os', 'machine_arch']) {
      const descriptor = Object.getOwnPropertyDescriptor(shape, field);
      if (descriptor && typeof descriptor.value !== 'string') {
        throw new InstanceSizeError('invalid', 'Namespace platform selectors must be strings when present');
      }
    }
    const os = shape.os ?? config.os ?? 'linux';
    const arch = shape.machine_arch ?? config.machineArch ?? 'amd64';
    if (os !== 'linux' || arch !== 'amd64' || shape.machineArch !== undefined) {
      return { status: 'unknown', reason: 'Standard shapes are verified only for Namespace Linux amd64, not this OS/architecture.' };
    }
    if (profile.sizeClass === 'xs' || profile.sizeClass === '2xl') {
      return { status: 'unknown', reason: 'This adapter has not verified this standard shape.' };
    }
    return { status: 'supported', nativeOptions: {
      instanceOptions: { shape: { virtual_cpu: profile.vcpus, memory_megabytes: profile.memoryMiB, os: 'linux', machine_arch: 'amd64' } },
    } };
  },

  methods: {
    instances: {
      create: async (config: NamespaceConfig, options?: CreateInstanceOptions) => {
        const { token } = await getAndValidateCredentials(config);
        const containerName = config.targetContainerName || 'main-container';
        const image = options?.image;
        const mounts = options?.volumes;
        const unifiedMounts = isUnifiedVolumeMounts(mounts) ? mounts : [];
        const instanceOptions = plainObject(options?.instanceOptions) as Record<string, any>;
        const containerOptions = plainObject(options?.containerOptions) as Record<string, any>;

        try {
          // Snapshot volume: opt-in (config or per-create `snapshotVolume`),
          // always present on a snapshotId restore. A restore must reuse the
          // source volume's tag and request at least its size.
          const volumeOptions =
            resolveSnapshotVolumeOptions(options?.snapshotVolume) ??
            resolveSnapshotVolumeOptions(config.snapshotVolume);
          let snapshotVolume: { tag: string; mountPath: string; sizeMb: number; fromVolumeId?: string; cell?: string } | undefined;
          if (options?.snapshotId) {
            const { tag, volumeId } = parseNamespaceSnapshotId(options.snapshotId);
            const source = await describeSourceVolume(token, volumeId, tag);
            snapshotVolume = {
              tag,
              mountPath: volumeOptions?.mountPath || DEFAULT_SNAPSHOT_MOUNT_PATH,
              sizeMb: Math.max(volumeOptions?.sizeMb ?? 0, source.sizeMb ?? RUNTIME_VOLUME_SIZE_MB),
              fromVolumeId: volumeId,
              ...(source.cell && { cell: source.cell }),
            };
          } else if (volumeOptions) {
            snapshotVolume = {
              tag: `computesdk-${randomUUID().slice(0, 12)}`,
              mountPath: volumeOptions.mountPath || DEFAULT_SNAPSHOT_MOUNT_PATH,
              sizeMb: volumeOptions.sizeMb ?? RUNTIME_VOLUME_SIZE_MB,
            };
          }

          const volumes = [
            ...(snapshotVolume ? [{
              mount_point: SNAPSHOT_VOLUME_HOST_PATH,
              tag: snapshotVolume.tag,
              persistency_kind: 'PERSISTENT',
              size_mb: snapshotVolume.sizeMb,
              ...(snapshotVolume.fromVolumeId && { from_snapshot_id: snapshotVolume.fromVolumeId }),
            }] : []),
            // Unified mounts → tag-keyed PERSISTENT volumes; they
            // materialize on attach.
            ...unifiedMounts.map((m: any, i: number) => ({
              mount_point: `${VOLUME_HOST_ROOT}/volume${i}`,
              tag: resolveVolumeRef(m.volume).name ?? resolveVolumeRef(m.volume).id,
              persistency_kind: 'PERSISTENT',
              size_mb: RUNTIME_VOLUME_SIZE_MB,
            })),
          ];
          // Bind each VM-level volume into the container — the
          // CommandService execs inside the container, so a VM-side mount
          // alone is invisible to runCommand.
          const hostMounts = [
            ...(snapshotVolume ? [{ host_path: SNAPSHOT_VOLUME_HOST_PATH, container_path: snapshotVolume.mountPath }] : []),
            ...unifiedMounts.map((m: any, i: number) => ({
              host_path: `${VOLUME_HOST_ROOT}/volume${i}`,
              container_path: m.mountPath,
            })),
          ];

          const requestBody = {
            ...plainObject(options?.instanceOptions),
            shape: {
              virtual_cpu: config.virtualCpu || 2,
              memory_megabytes: config.memoryMegabytes || 4096,
              machine_arch: config.machineArch || 'amd64',
              os: config.os || 'linux',
              // Per-create shape override: instanceOptions.shape takes
              // precedence over the factory config.
              ...(plainObject(options?.instanceOptions).shape as Record<string, unknown> | undefined),
            },
            ...(volumes.length > 0 && {
              volumes: [...(Array.isArray(instanceOptions.volumes) ? instanceOptions.volumes : []), ...volumes],
            }),
            ...(snapshotVolume?.cell && !instanceOptions.placement && {
              placement: [`cell:${snapshotVolume.cell}`],
            }),
            ...(snapshotVolume && {
              labels: [
                ...(Array.isArray(instanceOptions.labels) ? instanceOptions.labels : []),
                { name: SNAPSHOT_TAG_LABEL, value: snapshotVolume.tag },
                { name: SNAPSHOT_MOUNT_LABEL, value: Buffer.from(snapshotVolume.mountPath).toString('base64url') },
              ],
            }),
            containers: [{
              ...withoutImageSelector(plainObject(options?.containerOptions)),
              name: containerName,
              ...(image === undefined
                ? { known_image_id: 'builtin:base' }
                : { image_ref: image }),
              args: ['sleep', 'infinity'],
              ...(options?.envs && Object.keys(options.envs).length > 0 && {
                environment: options.envs
              }),
              // Mounts the instance's managed dockerd socket (e.g.
              // '/var/run/docker.sock') so the container can drive Docker —
              // the daemon runs on the micro-VM, not inside the container,
              // which needs no elevated container privileges.
              ...(typeof options?.dockerSockPath === 'string' &&
                options.dockerSockPath !== '' && {
                  docker_sock_path: options.dockerSockPath
                }),
              ...(hostMounts.length > 0 && {
                experimental: {
                  ...containerOptions.experimental,
                  host_mount: [
                    ...(containerOptions.experimental?.host_mount ?? []),
                    ...hostMounts,
                  ],
                },
              }),
            }],
            documented_purpose: config.documentedPurpose || 'ComputeSDK sandbox',
            deadline: new Date(
              Date.now() +
                (typeof options?.timeout === 'number' &&
                Number.isFinite(options.timeout) &&
                options.timeout > 0
                  ? options.timeout
                  : 60 * 60 * 1000)
            ).toISOString()
          };

          const responseData = await fetchNamespace(token, API_ENDPOINTS.CREATE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });

          if (!responseData.metadata?.instanceId) {
            throw new Error(`Instance ID is undefined. Full response object: ${JSON.stringify(responseData, null, 2)}`);
          }

          const instanceId = responseData.metadata.instanceId;
          const commandServiceEndpoint = responseData.extendedMetadata?.commandServiceEndpoint;

          const sandbox: NamespaceSandbox = {
            instanceId,
            name: `instance-${instanceId}`,
            commandServiceEndpoint,
            token,
            targetContainerName: containerName,
            createdAt: new Date(),
            ...(snapshotVolume && { snapshotVolumeMountPoint: snapshotVolume.mountPath }),
          };

          return { instance: sandbox, instanceId: instanceId };
        } catch (error) {
          throw new Error(
            `Failed to create Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: NamespaceConfig, sandboxId: string) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          const responseData = await fetchNamespace(token, API_ENDPOINTS.DESCRIBE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({ instance_id: sandboxId })
          });

          if (!responseData.metadata?.instanceId) {
            throw new Error('Instance data is missing from Namespace response');
          }

          // A destroyed instance stays describable (its status moves to
          // DESTROYING/DESTROYED, NotFound only comes later) — absent the
          // status check, callers confirming a deletion see it alive forever.
          if (isGoneInstance(responseData.metadata)) return null;

          const instanceId = responseData.metadata.instanceId;
          const sandbox: NamespaceSandbox = {
            instanceId,
            name: `instance-${instanceId}`,
            commandServiceEndpoint: responseData.extendedMetadata?.commandServiceEndpoint,
            token,
            targetContainerName: config.targetContainerName || 'main-container',
            createdAt: responseData.metadata?.createdAt ? new Date(responseData.metadata.createdAt) : new Date(0),
            status: instanceStatus(responseData.metadata),
          };
          const mountPoint = snapshotMountFromLabels(responseData.metadata?.labels);
          if (mountPoint) sandbox.snapshotVolumeMountPoint = mountPoint;

          return { instance: sandbox, instanceId: instanceId };
        } catch (error) {
          if (isNamespaceNotFound(error)) return null;
          throw new Error(
            `Failed to get Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: NamespaceConfig) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          const responseData = await fetchNamespace(token, API_ENDPOINTS.LIST_INSTANCES, {
            method: 'POST',
            body: JSON.stringify({})
          });

          const instances = responseData?.instances || [];

          return instances
            .filter(
              (instanceData: any) =>
                (instanceData.instanceId || instanceData.metadata?.instanceId) &&
                !isGoneInstance(instanceData.metadata),
            )
            .map((instanceData: any) => {
              const instanceId = instanceData.instanceId || instanceData.metadata.instanceId;
              const sandbox: NamespaceSandbox = {
                instanceId,
                name: `instance-${instanceId}`,
                commandServiceEndpoint: instanceData.extendedMetadata?.commandServiceEndpoint,
                token,
                targetContainerName: config.targetContainerName || 'main-container',
                createdAt: instanceData.metadata?.createdAt ? new Date(instanceData.metadata.createdAt) : new Date(0),
                status: instanceStatus(instanceData.metadata),
              };
              const mountPoint = snapshotMountFromLabels(instanceData.metadata?.labels);
              if (mountPoint) sandbox.snapshotVolumeMountPoint = mountPoint;
              return { instance: sandbox, instanceId: instanceId };
            });
        } catch (error) {
          throw new Error(
            `Failed to list Namespace instances: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: NamespaceConfig, sandboxId: string) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          await fetchNamespace(token, API_ENDPOINTS.DESTROY_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({
              instance_id: sandboxId,
              reason: config.destroyReason || "ComputeSDK cleanup"
            })
          });
        } catch (error) {
          throw new Error(
            `Failed to destroy Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: NamespaceSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        if (!sandbox.commandServiceEndpoint) {
          throw new Error('Command service endpoint not available. The instance may not support command execution.');
        }

        const startTime = Date.now();

        try {
          const timeoutMs = commandTimeoutMs(options);

          const result = await fetchNamespace(
            sandbox.token,
            COMMAND_SERVICE.RUN_COMMAND_SYNC,
            {
              method: 'POST',
              headers:
                // Connect protocol deadline: the server aborts the command
                // when it expires (Namespace's `timeoutMs` call option maps
                // to this header). The client-side abort only fires if the
                // server ignores it — a wedged exec must never hang.
                timeoutMs !== undefined
                  ? { 'Connect-Timeout-Ms': String(timeoutMs) }
                  : undefined,
              signal:
                timeoutMs !== undefined
                  ? AbortSignal.timeout(timeoutMs + 10_000)
                  : undefined,
              body: JSON.stringify({
                instanceId: sandbox.instanceId,
                targetContainerName: sandbox.targetContainerName,
                command: wireCommand(command, withDefaultCwd(sandbox, options)),
              })
            },
            sandbox.commandServiceEndpoint
          ) as {
            stdout?: string;
            stderr?: string;
            exitCode?: number;
          };

          const decodeBase64 = (data?: string): string => {
            if (!data) return '';
            try { return Buffer.from(data, 'base64').toString(); } catch { return data; }
          };

          return {
            stdout: decodeBase64(result.stdout),
            ...realExitStatus(decodeBase64(result.stderr), result.exitCode ?? 0),
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          throw new Error(
            `Namespace command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      streamCommand: async (sandbox: NamespaceSandbox, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        if (!sandbox.commandServiceEndpoint) {
          throw new Error('Command service endpoint not available. The instance may not support command execution.');
        }
        return streamNamespaceCommand(sandbox, wireCommand(command, withDefaultCwd(sandbox, options)), options);
      },

      getInfo: async (sandbox: NamespaceSandbox): Promise<InstanceInfo> => {
        // The handle's status is a snapshot; describe the instance live so a
        // long-held handle sees suspensions and destruction as they happen.
        try {
          const responseData = await fetchNamespace(sandbox.token, API_ENDPOINTS.DESCRIBE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({ instance_id: sandbox.instanceId })
          });
          sandbox.status = instanceStatus(responseData.metadata);
        } catch (error) {
          if (isNamespaceNotFound(error)) {
            // DescribeInstance only reaches NotFound once the terminal
            // statuses have passed — the instance is gone either way.
            sandbox.status = 'destroyed';
          } else {
            throw new Error(
              `Failed to get Namespace instance info: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        return {
          id: sandbox.instanceId,
          provider: 'namespace',
          status:
            sandbox.status === 'error'
              ? 'error'
              : sandbox.status === 'destroyed' ||
                  sandbox.status === 'destroying' ||
                  sandbox.status === 'suspended' ||
                  sandbox.status === 'suspending'
                ? 'stopped'
                : 'running',
          createdAt: sandbox.createdAt,
          timeout: 0,
          metadata: {
            name: sandbox.name,
            commandServiceEndpoint: sandbox.commandServiceEndpoint,
            ...(sandbox.snapshotVolumeMountPoint && {
              snapshotVolumeMountPoint: sandbox.snapshotVolumeMountPoint,
            }),
          }
        };
      },

      getUrl: async (_sandbox: NamespaceSandbox, _options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error('Namespace provider does not support getUrl.');
      },

      getInstance: (sandbox: NamespaceSandbox): NamespaceSandbox => sandbox,
    },

    // Namespace snapshots are volume-backed: a PERSISTENT volume is
    // snapshotted when its instance shuts down, and a new volume is seeded
    // from it via VolumeRequest.from_snapshot_id. Only sandboxes created with
    // a snapshot volume (opt-in `snapshotVolume`, or a restore) can snapshot;
    // the rootfs is never captured.
    snapshot: {
      capabilities: {
        scope: 'volume',
        path: DEFAULT_SNAPSHOT_MOUNT_PATH,
        memory: false,
        destroysSource: true,
        createOptions: { snapshotVolume: true },
      },
      create: async (config: NamespaceConfig, sandboxId: string, options?: CreateSnapshotOptions) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          const described = await fetchNamespace(token, API_ENDPOINTS.DESCRIBE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({ instance_id: sandboxId })
          });
          const tag = labelValue(described?.metadata?.labels, SNAPSHOT_TAG_LABEL);
          if (!tag) {
            throw new Error(
              `sandbox ${sandboxId} has no snapshot volume; create it with \`snapshotVolume: true\` (provider config or create option) to make it snapshot-capable`
            );
          }
          const mountPath = snapshotMountFromLabels(described?.metadata?.labels);
          const source = (await listVolumeSnapshotRecords(token, tag))
            .find((r) => r.id && snapshotAttachedInstance(r) === sandboxId);
          if (!source?.id) {
            throw new Error(`no persistent volume with tag ${tag} is attached to sandbox ${sandboxId}`);
          }
          const volumeId = source.id;

          // The snapshot is taken on shutdown, so the source sandbox is
          // destroyed — there is no live-instance snapshot RPC.
          await fetchNamespace(token, API_ENDPOINTS.DESTROY_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({ instance_id: sandboxId, reason: 'ComputeSDK snapshot' })
          });

          const timeoutMs = config.snapshotTimeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const record = (await listVolumeSnapshotRecords(token, tag)).find((r) => r.id === volumeId);
            const generationId = record && snapshotGeneration(record);
            const releasedAt = record && snapshotReleasedAt(record);
            if (generationId && releasedAt) {
              return {
                id: `${tag}/${volumeId}`,
                provider: 'namespace',
                createdAt: new Date(releasedAt),
                metadata: {
                  volumeId,
                  volumeTag: tag,
                  generationId,
                  sourceInstance: sandboxId,
                  ...(mountPath && { mountPath }),
                  ...(options?.name && { name: options.name }),
                  ...options?.metadata,
                },
              };
            }
            await sleep(SNAPSHOT_POLL_INTERVAL_MS);
          }
          throw new Error(`volume ${tag}/${volumeId} snapshot did not commit within ${timeoutMs}ms`);
        } catch (error) {
          throw new Error(
            `Failed to create Namespace snapshot: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: NamespaceConfig, options?: ListSnapshotsOptions) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          // Snapshot records are only listed per volume tag (an unfiltered
          // request returns an arbitrary few), so list each tag's records.
          // Each record's `id` is the VOLUME id; a committed record has a
          // `completedSnapshot` generation and a `releasedAt`. Abandoned
          // (deleted) records stay listed by the API and are skipped here.
          const tags = [...new Set((await listPersistentVolumes(token)).map((v) => v.tag).filter((t): t is string => !!t))];
          const recordsByTag = await mapLimit(tags, 8, (tag) => listVolumeSnapshotRecords(token, tag));

          const snapshots = [];
          for (const [i, snap] of recordsByTag.flatMap((records, i) => records.map((r) => [i, r] as const))) {
            const tag = tags[i];
            const generationId = snapshotGeneration(snap);
            const releasedAt = snapshotReleasedAt(snap);
            if (!snap.id || !generationId || !releasedAt || isAbandoned(snap)) continue;
            const sourceInstance = snapshotAttachedInstance(snap);
            if (options?.sandboxId && sourceInstance !== options.sandboxId) continue;
            snapshots.push({
              id: `${tag}/${snap.id}`,
              provider: 'namespace',
              createdAt: new Date(releasedAt),
              metadata: {
                volumeId: snap.id,
                volumeTag: tag,
                generationId,
                ...(sourceInstance && { sourceInstance }),
                ...(snapshotParent(snap) && { snapshotFrom: snapshotParent(snap) }),
              },
            });
          }

          snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return options?.limit ? snapshots.slice(0, options.limit) : snapshots;
        } catch (error) {
          throw new Error(
            `Failed to list Namespace snapshots: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      delete: async (config: NamespaceConfig, snapshotId: string) => {
        const { token } = await getAndValidateCredentials(config);
        const { tag, volumeId } = parseNamespaceSnapshotId(snapshotId);

        try {
          // Abandons the snapshot: later restores from it fail. The API keeps
          // the record (with `abandonedAt`).
          await fetchNamespace(token, STORAGE_SERVICE.DESTROY_PERSISTENT_VOLUME_SNAPSHOT, {
            method: 'POST',
            body: JSON.stringify({ id: volumeId, tag })
          });
        } catch (error) {
          if (isNamespaceNotFound(error)) return;
          throw new Error(
            `Failed to delete Namespace snapshot: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
    },

    // Namespace volumes are tag-named and materialize when attached at
    // instance create — create() records the handle; provisioning happens in
    // CreateInstanceRequest.volumes. Every storage API op filters on tag, so
    // Volume.id IS the tag — delete(tag) destroys directly with no lookup.
    volume: {
      create: async (_config: NamespaceConfig, options) => ({ id: options.name, name: options.name }),
      get: async (config: NamespaceConfig, tag: string) => {
        const { token } = await getAndValidateCredentials(config);
        // The tag filter on List is a plain string, not a matcher object —
        // the object form is rejected with invalid_argument.
        const response = await fetchNamespace(token, STORAGE_SERVICE.LIST_PERSISTENT_VOLUMES, {
          method: 'POST',
          body: JSON.stringify({ tag })
        });
        const volume = (response.volumes || [])[0];
        return volume ? { id: volume.tag ?? tag, name: volume.tag ?? tag, native: volume } : null;
      },
      list: async (config: NamespaceConfig, options) => {
        const { token } = await getAndValidateCredentials(config);
        const out: any[] = [];
        let cursor: string | undefined;
        do {
          const response = await fetchNamespace(token, STORAGE_SERVICE.LIST_PERSISTENT_VOLUMES, {
            method: 'POST',
            body: JSON.stringify(cursor ? { pagination_cursor: cursor } : {})
          });
          for (const v of response.volumes || []) out.push({ id: v.tag, name: v.tag, native: v });
          cursor = response.pagination_cursor || undefined;
        } while (cursor && (!options?.limit || out.length < options.limit));
        return options?.limit ? out.slice(0, options.limit) : out;
      },
      delete: async (config: NamespaceConfig, tag: string) => {
        const { token } = await getAndValidateCredentials(config);
        await withVolumeSettle(() => fetchNamespace(token, STORAGE_SERVICE.DESTROY_PERSISTENT_VOLUMES, {
          method: 'POST',
          // StringMatcher: values + op IS_ANY_OF (1)
          body: JSON.stringify({ tag: { values: [tag], op: 1 } })
        }));
      },
    },
  }
});

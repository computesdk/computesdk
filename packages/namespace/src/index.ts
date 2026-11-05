/**
 * Namespace Provider
 *
 * Full-featured provider using the factory pattern.
 * Supports instance lifecycle management and command execution via Namespace Compute API.
 */

import * as fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { defineProvider, escapeShellArg, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle, InstanceSizeError, TIMEOUT_EXIT_CODE, START_FAILURE_EXIT_CODE } from '@computesdk/provider';
import type { CommandResult, InstanceInfo, CreateInstanceOptions, RunCommandOptions, ListSnapshotsOptions } from '@computesdk/provider';

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
  /** Mountpoint of the persistent volume seeded from a snapshot, when created via snapshotId. */
  snapshotVolumeMountPoint?: string;
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

async function listVolumeSnapshotRecords(token: string): Promise<WireSnapshotRecord[]> {
  const response = await fetchNamespace(token, STORAGE_SERVICE.LIST_PERSISTENT_VOLUME_SNAPSHOTS, {
    method: 'POST',
    body: JSON.stringify({})
  });
  return response.snapshots || [];
}

/**
 * Mountpoint for the persistent volume attached when `create({ snapshotId })`
 * restores a sandbox — this is where the snapshotted filesystem state lands.
 */
const SNAPSHOT_VOLUME_MOUNTPOINT = '/computesdk-data';

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

/** `command` with the caller's env, cwd and background options applied as shell. */
function shellCommand(command: string, options?: RunCommandOptions): string {
  let fullCommand = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
      .join(' ');
    fullCommand = `${envPrefix} ${fullCommand}`;
  }

  if (options?.cwd) {
    fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
  }

  if (options?.background) {
    fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
  }

  return fullCommand;
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
 * Streams `fullCommand` over CommandService.RunCommand. Exit codes follow the
 * other native streamers: timeout 124, failure before any output 127, stream
 * lost before its exit status -1 (RunCommand has no way to recover it).
 */
async function streamNamespaceCommand(sandbox: NamespaceSandbox, fullCommand: string, options: RunCommandOptions): Promise<CommandResult> {
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
      command: { command: ['sh', '-c', fullCommand] },
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

        try {
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
            // snapshotId restores filesystem state by seeding a new
            // persistent volume from the given snapshot — Namespace's
            // fork model is volume-backed rather than whole-instance.
            ...(options?.snapshotId && {
              volumes: [{
                mount_point: SNAPSHOT_VOLUME_MOUNTPOINT,
                tag: `computesdk-${randomUUID().slice(0, 8)}`,
                persistency_kind: 'PERSISTENT',
                from_snapshot_id: options.snapshotId,
              }],
            }),
            // Unified mounts → instanceOptions.volumes entries (tag-keyed
            // PERSISTENT volumes; they materialize on attach).
            ...(isUnifiedVolumeMounts(mounts) && {
              volumes: [
                ...(options?.snapshotId ? [{
                  mount_point: SNAPSHOT_VOLUME_MOUNTPOINT,
                  tag: `computesdk-${randomUUID().slice(0, 8)}`,
                  persistency_kind: 'PERSISTENT',
                  from_snapshot_id: options.snapshotId,
                }] : []),
                ...mounts.map((m: any, i: number) => ({
                  mount_point: `${VOLUME_HOST_ROOT}/volume${i}`,
                  tag: resolveVolumeRef(m.volume).name ?? resolveVolumeRef(m.volume).id,
                  persistency_kind: 'PERSISTENT',
                  size_mb: RUNTIME_VOLUME_SIZE_MB,
                })),
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
              // Bind each VM-level volume into this container at the
              // requested mountPath — the CommandService execs inside the
              // container, so a VM-side mount alone is invisible to
              // runCommand.
              ...(isUnifiedVolumeMounts(mounts) && {
                experimental: {
                  ...(plainObject(options?.containerOptions) as any)?.experimental,
                  host_mount: [
                    ...((plainObject(options?.containerOptions) as any)?.experimental?.host_mount ?? []),
                    ...mounts.map((m: any, i: number) => ({
                      host_path: `${VOLUME_HOST_ROOT}/volume${i}`,
                      container_path: m.mountPath,
                    })),
                  ],
                },
              })
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
            ...(options?.snapshotId && { snapshotVolumeMountPoint: SNAPSHOT_VOLUME_MOUNTPOINT }),
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
          const fullCommand = shellCommand(command, options);
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
                command: {
                  command: ['sh', '-c', fullCommand],
                },
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
        return streamNamespaceCommand(sandbox, shellCommand(command, options), options);
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

    // Namespace snapshots are volume-backed: persistent volumes are
    // snapshotted automatically on instance shutdown, and a new volume can be
    // seeded from a snapshot via VolumeRequest.from_snapshot_id.
    snapshot: {
      create: async () => {
        throw new Error(
          'Namespace cannot create snapshots on demand — persistent-volume snapshots are captured automatically when an instance with a PERSISTENT volume shuts down. Create a sandbox with a persistent volume (snapshotId path) and list snapshots after it stops.'
        );
      },

      list: async (config: NamespaceConfig, options?: ListSnapshotsOptions) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          // Snapshot records come back workspace-wide whatever the request
          // body — the `id` field is not a filter — so one call lists
          // everything; each record's `id` is the VOLUME id it belongs to
          // (not the generation) and joins it to the volume's metadata.
          const volumes = await listPersistentVolumes(token);
          const volumeById = new Map(volumes.map((v) => [v.id, v]));
          const records = await listVolumeSnapshotRecords(token);

          const snapshots = [];
          for (const snap of records) {
            const generationId = snapshotGeneration(snap);
            const sourceInstance = snapshotAttachedInstance(snap);
            // attachedInstanceId links a snapshot back to the instance
            // whose volume produced it.
            if (options?.sandboxId && sourceInstance !== options.sandboxId) continue;
            const volume = snap.id ? volumeById.get(snap.id) : undefined;
            snapshots.push({
              // `tag/<gen>` is what `create({ snapshotId })` restores via
              // `from_snapshot_id`, so listed snapshots feed straight back in.
              id: volume?.tag && generationId
                ? `${volume.tag}/${generationId}`
                : generationId ?? snap.id ?? '',
              provider: 'namespace',
              createdAt: snap.createdAt
                ? new Date(snap.createdAt)
                : snap.created_at
                  ? new Date(snap.created_at)
                  : new Date(0),
              metadata: {
                ...(snap.id && { volumeId: snap.id }),
                ...(generationId && { generationId }),
                ...(volume?.tag && { volumeTag: volume.tag }),
                ...(volume?.site && { site: volume.site }),
                ...(sourceInstance && { sourceInstance }),
                ...(snap.abandonedAt || snap.abandoned_at ? { abandoned: 'true' } : {}),
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

        try {
          // DestroyPersistentVolumeSnapshot addresses the artifact by its
          // volume — {id: volumeId, tag} — never by the generation. The match
          // is the volume (bearing the tag, when the id names one) whose
          // records actually hold the generation — tags are not unique, and
          // when no volume holds it the artifact is unreachable and there is
          // nothing left to abandon.
          const slash = snapshotId.indexOf('/');
          const tag = slash === -1 ? undefined : snapshotId.slice(0, slash);
          const generationId = slash === -1 ? snapshotId : snapshotId.slice(slash + 1);

          const records = await listVolumeSnapshotRecords(token);
          const holding = new Set(
            records
              .filter((r) => snapshotGeneration(r) === generationId && r.id !== undefined)
              .map((r) => r.id as string),
          );
          const volumes: WireVolume[] =
            tag === undefined
              ? await listPersistentVolumes(token)
              : ((await fetchNamespace(token, STORAGE_SERVICE.LIST_PERSISTENT_VOLUMES, {
                  method: 'POST',
                  body: JSON.stringify({ tag }),
                })).volumes || []);
          const volume = volumes.find((v) => holding.has(v.id) && v.tag !== undefined);
          if (volume === undefined) return;

          await fetchNamespace(token, STORAGE_SERVICE.DESTROY_PERSISTENT_VOLUME_SNAPSHOT, {
            method: 'POST',
            body: JSON.stringify({ id: volume.id, tag: volume.tag })
          });
        } catch (error) {
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

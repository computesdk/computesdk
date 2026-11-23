/**
 * Styne provider implementation. `index.ts` exports its public part.
 *
 * Talks to the Styne REST API (https://docs.styne.ai/api-reference) directly over one shared
 * HTTP/2 session per API host: creates and account-wide calls go to the configured host, and
 * the calls about a sandbox go to the API host of the region it runs in. Sandboxes are
 * microVMs: commands stream their output as NDJSON frames, files move through the files API,
 * snapshots keep memory and disk and leave the source running, and volumes persist across
 * sandboxes.
 */

import { defineProvider, escapeShellArg, InstanceSizeError, ShellFileSystem } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  CreateTemplateOptions,
  CreateVolumeOptions,
  FileEntry,
  InstanceInfo,
  InstanceSizeClass,
  ListSnapshotsOptions,
  ListTemplatesOptions,
  ListVolumesOptions,
  RunCommandOptions,
  Volume,
  VolumeMount,
} from '@computesdk/provider';
import type { Snapshot } from 'computesdk';
import { call, DEFAULT_API_URL, errorCodeOf, expectStatus, newIdempotencyKey, parseJson, request, retryAfterMs, StyneApiError } from './client';
import type { ClientConfig, Reply } from './client';
import { forgetRoute, learnRoute, sandboxRequest } from './region';

export interface StyneConfig {
  /** Styne API key - falls back to the STYNE_API_KEY environment variable */
  apiKey?: string;
  /** API base URL - falls back to STYNE_API_URL, then https://api.styne.ai */
  apiUrl?: string;
  /** Default sandbox lifetime in milliseconds when `create` gets no `timeout` (the API default is 300000) */
  timeout?: number;
}

export interface StyneInstance {
  id: string;
  /** The `name` the sandbox was created with (kept in its metadata) */
  name?: string;
  /** Domain that serves the sandbox's ports as `<port>-<id>.<domain>` */
  domain?: string;
  client: ClientConfig;
}

export interface StyneTemplate {
  id: string;
  name: string;
  provider: 'styne';
  /** Built-in templates come from Styne; the others are snapshots saved by this account. */
  builtin: boolean;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface StyneTemplateOptions extends CreateTemplateOptions {
  /** Container image the template starts from */
  image?: string;
  /** Built-in template or saved snapshot the template starts from when no image is given */
  templateId?: string;
}

/** Exit code reported for a command stopped at its `timeout`, as the coreutils `timeout` command does. */
export const TIMEOUT_EXIT_CODE = 124;

const DEFAULT_LIFETIME_MS = 300_000;
const MAX_LIFETIME_MS = 86_400_000;
const VOLUME_RELEASE_WAIT_MS = 30_000;
/** How long a create keeps repeating while the API asks for it again (capacity, an image being prepared). */
const CREATE_RETRY_WAIT_MS = 60_000;
/** Extra time a command with a `timeout` gets before its request is given up, so the API reports the timeout itself. */
const COMMAND_TIMEOUT_GRACE_MS = 30_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveConfig(config: StyneConfig): ClientConfig {
  const apiKey = config.apiKey || process.env.STYNE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing Styne API key.\n\n' +
        'Create one on the API keys page of the Styne dashboard (https://app.styne.ai)\n' +
        'Then pass it: styne({ apiKey: "..." })\n' +
        'Or set STYNE_API_KEY in your environment.',
    );
  }
  const apiUrl = config.apiUrl || process.env.STYNE_API_URL || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error(`Invalid Styne API URL: ${apiUrl}`);
  }
  // The key travels in a header, so it may only go out unencrypted to the local machine.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error(`The Styne API URL must use https:// (plain http:// is accepted only for localhost): ${apiUrl}`);
  }
  return { apiKey, apiUrl };
}

const sandboxPath = (id: string, rest = '') => `/sandboxes/${encodeURIComponent(id)}${rest}`;
const filesPath = (id: string, path: string, rest = '') =>
  sandboxPath(id, `/files${rest}?path=${encodeURIComponent(path)}`);

// ---- sandboxes ----

interface SandboxRecord {
  sandboxID: string;
  state?: string;
  domain?: string;
  templateID?: string;
  startedAt?: string;
  endAt?: string;
  cpuCount?: number;
  memoryMB?: number;
  metadata?: Record<string, string>;
}

function stringMap(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

function mountOf(mount: VolumeMount) {
  const volume = typeof mount.volume === 'string' ? mount.volume : (mount.volume.name ?? mount.volume.id);
  if (!volume) throw new Error('A Styne volume mount needs a volume name or id.');
  return { name: volume, path: mount.mountPath, readOnly: mount.readOnly === true };
}

/** The sandbox sizes `POST /sandboxes` takes as `size`, smallest first. */
export const STYNE_SIZES = ['small', 'default', 'large', 'xlarge'] as const;
export type StyneSize = (typeof STYNE_SIZES)[number];

/**
 * The shape of each size (https://docs.styne.ai/limits#sandbox-sizes), and the standard size it is. Sizes start at
 * 2 vCPU and end at 16 vCPU, so `xs`, `sm` and `3xl` have no Styne size.
 */
export const STYNE_SIZE_SHAPES: Readonly<Partial<Record<InstanceSizeClass, { size: StyneSize; vcpus: number; memoryMiB: number; diskMiB: number }>>> = Object.freeze({
  md: Object.freeze({ size: 'small', vcpus: 2, memoryMiB: 4096, diskMiB: 52224 }),
  lg: Object.freeze({ size: 'default', vcpus: 4, memoryMiB: 8192, diskMiB: 52224 }),
  xl: Object.freeze({ size: 'large', vcpus: 8, memoryMiB: 16384, diskMiB: 113664 }),
  '2xl': Object.freeze({ size: 'xlarge', vcpus: 16, memoryMiB: 32768, diskMiB: 257024 }),
});

type SizeUnit = 'vcpus' | 'memoryMiB' | 'diskMiB';

/**
 * The universal CPU, memory and disk fields of `CreateInstanceOptions` that Styne reads, and what each counts. Other
 * providers' fields are left to them, as the options contract asks.
 */
const SIZE_FIELDS: Readonly<Record<string, SizeUnit>> = Object.freeze({
  vcpus: 'vcpus',
  cpus: 'vcpus',
  memoryMiB: 'memoryMiB',
  memMiB: 'memoryMiB',
  memoryMb: 'memoryMiB',
  diskMiB: 'diskMiB',
  diskMb: 'diskMiB',
});

/** A memory or disk value below this many MiB is a value in GiB put in a MiB field. */
const MIN_MIB_VALUE = 256;

export interface StyneSizeRequest {
  vcpus?: number;
  memoryMiB?: number;
  diskMiB?: number;
  /** The create options the request was read from, e.g. `vcpus` or `memoryMiB`. */
  fields: string[];
}

/**
 * Reads the CPU, memory and disk a create asks for through the universal `vcpus`, `memoryMiB` and `diskMiB` fields
 * (also `cpus`, `memMiB`, `memoryMb` and `diskMb`, read in vCPUs and MiB) rather than `sizeClass` or `size`. Returns
 * `undefined` when it asks for none. A value Styne cannot read, or two fields that disagree, throws instead of
 * being dropped.
 */
export function sizeRequestOf(options: CreateInstanceOptions = {}): StyneSizeRequest | undefined {
  const request: StyneSizeRequest = { fields: [] };
  for (const [field, unit] of Object.entries(SIZE_FIELDS)) {
    const value = Object.prototype.hasOwnProperty.call(options, field) ? (options as Record<string, unknown>)[field] : undefined;
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new InstanceSizeError('invalid', `${field} must be a positive number, not ${JSON.stringify(value)}`);
    }
    if (unit === 'vcpus' && !Number.isInteger(value)) {
      throw new InstanceSizeError('invalid', `${field} counts whole vCPUs; ${value} is not one`);
    }
    if (unit !== 'vcpus' && value < MIN_MIB_VALUE) {
      throw new InstanceSizeError('invalid', `${field} is read in MiB, and ${value} MiB is too small for a sandbox`);
    }
    const earlier = request[unit];
    if (earlier !== undefined && earlier !== value) {
      throw new InstanceSizeError('conflict', `${field} asks for ${value} where ${request.fields.join(', ')} asked for ${earlier}`);
    }
    request[unit] = value;
    request.fields.push(field);
  }
  return request.fields.length > 0 ? request : undefined;
}

/** The create options that size a sandbox other than `sizeClass` and `size`, by name. */
function sizeFieldsIn(options: CreateInstanceOptions = {}): string[] {
  return Object.keys(SIZE_FIELDS).filter((key) => (options as Record<string, unknown>)[key] !== undefined);
}

const gib = (mib: number) => `${Math.round((mib / 1024) * 10) / 10} GiB`;

function describeRequest(request: StyneSizeRequest): string {
  const parts: string[] = [];
  if (request.vcpus !== undefined) parts.push(`${request.vcpus} vCPU`);
  if (request.memoryMiB !== undefined) parts.push(`${request.memoryMiB} MiB memory`);
  if (request.diskMiB !== undefined) parts.push(`${request.diskMiB} MiB disk`);
  return `${parts.join(' / ')} (${request.fields.join(', ')})`;
}

/**
 * The standard size whose Styne size gives exactly the vCPUs a raw request asks for and at least its memory and disk;
 * with no vCPU count, the smallest Styne size that has the memory and disk. Throws `InstanceSizeError` when no Styne
 * size gives that, rather than booting a different shape.
 */
export function sizeClassOf(request: StyneSizeRequest): InstanceSizeClass {
  const shapes = Object.entries(STYNE_SIZE_SHAPES) as [InstanceSizeClass, NonNullable<(typeof STYNE_SIZE_SHAPES)['md']>][];
  const holds = ([, shape]: (typeof shapes)[number]) =>
    (request.memoryMiB ?? 0) <= shape.memoryMiB && (request.diskMiB ?? 0) <= shape.diskMiB;
  if (request.vcpus !== undefined) {
    const same = shapes.find(([, shape]) => shape.vcpus === request.vcpus);
    if (!same) {
      throw new InstanceSizeError('unsupported', `Styne sizes have 2, 4, 8 or 16 vCPU (small, default, large, xlarge); none has the ${describeRequest(request)} asked for.`);
    }
    if (!holds(same)) {
      const shape = same[1];
      throw new InstanceSizeError('unsupported', `The ${shape.vcpus}-vCPU Styne size (${shape.size}) has ${gib(shape.memoryMiB)} memory and ${gib(shape.diskMiB)} disk, less than the ${describeRequest(request)} asked for.`);
    }
    return same[0];
  }
  const smallest = shapes.find(holds);
  if (!smallest) {
    throw new InstanceSizeError('unsupported', `The largest Styne size is xlarge, 16 vCPU / 32 GiB memory / 251 GiB disk, less than the ${describeRequest(request)} asked for.`);
  }
  return smallest[0];
}

/** Maps ComputeSDK create options to the body of `POST /sandboxes`. */
export function createBody(config: StyneConfig, options: CreateInstanceOptions = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // Raw CPU, memory and disk fields pick the Styne size that has them, or fail before any sandbox starts.
  const raw = sizeRequestOf(options);
  if (raw) {
    if (options.size !== undefined) {
      throw new InstanceSizeError('conflict', `cannot combine the native Styne size with ${raw.fields.join(', ')}`);
    }
    const fixed = options.snapshotId ? 'snapshotId' : options.image ? 'image' : options.templateId ? 'templateId' : undefined;
    if (fixed) {
      throw new InstanceSizeError('unsupported', `A Styne sandbox started from a ${fixed} keeps the size it was made with; drop ${raw.fields.join(', ')} or ${fixed}.`);
    }
  }
  const size = raw ? STYNE_SIZE_SHAPES[sizeClassOf(raw)]!.size : options.size;
  if (size !== undefined && (options.snapshotId || options.image)) {
    throw new Error('A Styne size applies to a new sandbox; one started from a snapshot or an image keeps the size it was made with.');
  }
  if (options.snapshotId) body.snapshot = options.snapshotId;
  else if (options.image) body.image = options.image;
  else if (options.templateId) body.templateID = options.templateId;
  if (size !== undefined) body.size = size;

  const timeout = options.timeout ?? config.timeout;
  if (typeof timeout === 'number' && timeout > 0) {
    body.timeout = Math.ceil(Math.min(timeout, MAX_LIFETIME_MS) / 1000);
  }
  if (options.envs) body.envVars = options.envs;

  const metadata = stringMap({ ...(options.metadata ?? {}), ...(options.name ? { name: options.name } : {}) });
  if (Object.keys(metadata).length > 0) body.metadata = metadata;

  if (options.volumes?.length) body.volumeMounts = options.volumes.map(mountOf);
  return body;
}

function toInstance(
  client: ClientConfig,
  record: { sandboxID?: string; sandboxId?: string; domain?: string; metadata?: Record<string, string> },
  name = record.metadata?.name,
): StyneInstance {
  const id = record.sandboxID ?? record.sandboxId;
  if (!id) throw new StyneApiError(0, 'Styne returned a sandbox without an id');
  learnRoute(client, id, record.domain);
  return { id, client, ...(record.domain === undefined ? {} : { domain: record.domain }), ...(name === undefined ? {} : { name }) };
}

/** `429` quotas that a retry cannot lift. */
const HARD_LIMITS = new Set(['quota_exceeded', 'resident_limit', 'storage_limit']);

/** How many times a create answered `500` or `502` is sent again under the same key. */
const SERVER_ERROR_REPEATS = 2;

/**
 * Whether a create answer asks for the same create again: capacity answers (`503`, `504`, a `429`
 * that is not a quota), an earlier attempt under the same key still being served (`409 conflict`),
 * or an image still being prepared (`202 image_building`). A `500` or a proxy's `502` is repeated
 * too, a bounded number of times: the API keeps no answer for a key that ended in a server error,
 * so the repeat either finds the sandbox the first attempt started or starts the only one.
 */
function createAgain(reply: Reply, serverErrors: number): boolean {
  if (reply.status === 500 || reply.status === 502) return serverErrors < SERVER_ERROR_REPEATS;
  if (reply.status === 503 || reply.status === 504) return true;
  const code = errorCodeOf(reply);
  if (reply.status === 429) return !HARD_LIMITS.has(code ?? '');
  if (reply.status === 409) return code === 'conflict';
  return reply.status === 202;
}

/**
 * Sends one `POST /sandboxes` under an `Idempotency-Key`. A create whose answer was lost is sent
 * again with the same key, and the API answers it with the sandbox the first one started, so a
 * lost answer never leaves a second sandbox running. A create the API asks to repeat is repeated
 * after `Retry-After` (one second when absent), with a growing delay, for up to a minute.
 */
async function postSandbox(client: ClientConfig, body: Record<string, unknown>): Promise<Reply> {
  const payload = JSON.stringify(body);
  let idempotencyKey = newIdempotencyKey();
  const deadline = Date.now() + CREATE_RETRY_WAIT_MS;
  let serverErrors = 0;
  for (let attempt = 0; ; attempt++) {
    // This loop waits on busy answers itself, for longer than a single request does.
    const reply = await request(client, 'POST', '/sandboxes', { body: payload, idempotencyKey, repeatWhenBusy: false });
    const left = deadline - Date.now();
    if (!createAgain(reply, serverErrors) || left <= 0) return reply;
    if (reply.status === 500 || reply.status === 502) serverErrors += 1;
    // A 202 started no sandbox, and the API keeps a 2xx answer for its key, so the repeat needs a new key.
    if (reply.status === 202) idempotencyKey = newIdempotencyKey();
    const wait = retryAfterMs(reply, 1000) * Math.min(2 ** attempt, 8);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, left)));
  }
}

async function createSandbox(config: StyneConfig, options?: CreateInstanceOptions): Promise<StyneInstance> {
  const client = resolveConfig(config);
  const body = createBody(config, options);
  let reply = await postSandbox(client, body);
  // A template saved through `template.create` is a snapshot, so a template id the API does not know is tried as one.
  if (reply.status === 404 && body.templateID !== undefined) {
    const { templateID, ...rest } = body;
    const retry = await postSandbox(client, { ...rest, snapshot: templateID });
    if (retry.status !== 404) reply = retry;
  }
  expectStatus(reply, 'create sandbox', [200, 201]);
  const record = JSON.parse(reply.body.toString('utf8'));
  return toInstance(client, record, options?.name ?? record.metadata?.name);
}

type SandboxRef = Pick<StyneInstance, 'client' | 'id' | 'domain'>;

async function readSandbox(sandbox: SandboxRef): Promise<SandboxRecord | null> {
  const reply = await sandboxRequest(sandbox, 'GET', sandboxPath(sandbox.id));
  if (reply.status === 404 || reply.status === 410) {
    forgetRoute(sandbox.client, sandbox.id);
    return null;
  }
  expectStatus(reply, 'read sandbox', [200]);
  const record = JSON.parse(reply.body.toString('utf8')) as SandboxRecord;
  learnRoute(sandbox.client, sandbox.id, record.domain);
  return record;
}

function infoStatus(state: string | undefined): InstanceInfo['status'] {
  if (state === undefined || state === 'running') return 'running';
  if (state === 'error' || state === 'failed') return 'error';
  return 'stopped';
}

function toInfo(id: string, record: SandboxRecord | null): InstanceInfo {
  const started = record?.startedAt ? Date.parse(record.startedAt) : NaN;
  const ends = record?.endAt ? Date.parse(record.endAt) : NaN;
  return {
    id,
    provider: 'styne',
    status: record ? infoStatus(record.state) : 'stopped',
    createdAt: Number.isNaN(started) ? new Date() : new Date(started),
    timeout: Number.isNaN(started) || Number.isNaN(ends) ? DEFAULT_LIFETIME_MS : ends - started,
    metadata: {
      state: record?.state ?? 'killed',
      templateId: record?.templateID,
      cpuCount: record?.cpuCount,
      memoryMB: record?.memoryMB,
      ...(record?.metadata ?? {}),
    },
  };
}

// ---- commands ----

interface ExecFrame {
  stdout?: string;
  stderr?: string;
  exit?: { exitCode?: number; signal?: number; timedOut?: boolean };
  error?: { message?: string; error_code?: string; request_id?: string };
}

/** The first NDJSON line of `POST /sandboxes/{id}/exec` for a ComputeSDK command. */
export function execRequest(command: string, options: RunCommandOptions = {}): string {
  const line: Record<string, unknown> = {
    cmd: 'sh',
    args: ['-c', options.background ? `nohup sh -c "${escapeShellArg(command)}" >/dev/null 2>&1 &` : command],
  };
  if (options.cwd) line.cwd = options.cwd;
  if (options.env && Object.keys(options.env).length > 0) line.env = options.env;
  if (!options.background && options.timeout && options.timeout > 0) line.timeoutMs = options.timeout;
  return JSON.stringify(line) + '\n';
}

/** Collects the output frames of one command, decoding each stream as UTF-8 across chunk boundaries. */
export class ExecOutput {
  stdout = '';
  stderr = '';
  exitCode: number | undefined;
  failure: ExecFrame['error'];
  private pending = '';
  private readonly frames = new TextDecoder();
  private readonly out = new TextDecoder();
  private readonly err = new TextDecoder();

  constructor(private readonly options: RunCommandOptions = {}) {}

  push(chunk: Uint8Array): void {
    this.pending += this.frames.decode(chunk, { stream: true });
    let newline = this.pending.indexOf('\n');
    while (newline >= 0) {
      this.frame(this.pending.slice(0, newline));
      this.pending = this.pending.slice(newline + 1);
      newline = this.pending.indexOf('\n');
    }
  }

  end(): void {
    this.frame(this.pending + this.frames.decode());
    this.pending = '';
    this.emit('stdout', this.out.decode());
    this.emit('stderr', this.err.decode());
  }

  private frame(line: string): void {
    if (line.trim() === '') return;
    let frame: ExecFrame;
    try {
      frame = JSON.parse(line) as ExecFrame;
    } catch {
      throw new StyneApiError(200, `Styne run command returned a line that is not JSON: ${line.slice(0, 200)}`);
    }
    if (frame.stdout !== undefined) {
      this.emit('stdout', this.out.decode(Buffer.from(frame.stdout, 'base64'), { stream: true }));
    } else if (frame.stderr !== undefined) {
      this.emit('stderr', this.err.decode(Buffer.from(frame.stderr, 'base64'), { stream: true }));
    } else if (frame.exit) {
      // A command killed by a signal reports 128 + the signal number, as a shell does.
      const { exitCode, signal, timedOut } = frame.exit;
      this.exitCode = timedOut ? TIMEOUT_EXIT_CODE : signal ? 128 + signal : (exitCode ?? -1);
    } else if (frame.error && frame.error.error_code !== 'command_timeout') {
      this.failure = frame.error;
    }
  }

  private emit(stream: 'stdout' | 'stderr', text: string): void {
    if (text === '') return;
    if (stream === 'stdout') {
      this.stdout += text;
      this.options.onStdout?.(text);
    } else {
      this.stderr += text;
      this.options.onStderr?.(text);
    }
  }
}

async function runCommand(instance: StyneInstance, command: string, options: RunCommandOptions = {}): Promise<CommandResult> {
  const start = Date.now();
  const output = new ExecOutput(options);
  // A command can stay silent for as long as it runs, so only a command with a timeout has a request limit.
  const limit = options.timeout && options.timeout > 0 ? options.timeout + COMMAND_TIMEOUT_GRACE_MS : 0;
  const reply = await sandboxRequest(instance, 'POST', sandboxPath(instance.id, '/exec'), {
    body: execRequest(command, options),
    onData: (chunk) => output.push(chunk),
    timeoutMs: options.background ? undefined : limit,
  });
  expectStatus(reply, 'run command', [200]);
  output.end();
  if (output.exitCode === undefined) {
    const failure = output.failure;
    throw new StyneApiError(
      reply.status,
      `Styne run command failed: ${failure?.message ?? 'the command ended without an exit status'}`,
      failure?.error_code,
      failure?.request_id,
    );
  }
  return { stdout: output.stdout, stderr: output.stderr, exitCode: output.exitCode, durationMs: Date.now() - start };
}

// ---- files ----

interface DirectoryEntry {
  name: string;
  type: string;
  size?: number;
  modified?: string | number;
}

async function readFile(instance: StyneInstance, path: string): Promise<string> {
  const reply = await sandboxRequest(instance, 'GET', filesPath(instance.id, path));
  expectStatus(reply, `read ${path}`, [200]);
  return reply.body.toString('utf8');
}

async function writeFile(instance: StyneInstance, path: string, content: string): Promise<void> {
  const reply = await sandboxRequest(instance, 'PUT', filesPath(instance.id, path), {
    body: content,
    contentType: 'application/octet-stream',
  });
  expectStatus(reply, `write ${path}`, [200, 201, 204]);
}

async function readdir(instance: StyneInstance, path: string): Promise<FileEntry[]> {
  const reply = await sandboxRequest(instance, 'GET', filesPath(instance.id, path, '/list'));
  expectStatus(reply, `list ${path}`, [200]);
  const { entries } = parseJson<{ entries: DirectoryEntry[] }>(reply, `list ${path}`);
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.type === 'dir' || entry.type === 'directory' ? 'directory' : 'file',
    size: entry.size ?? 0,
    // The API does not report modification times yet; symbolic links are listed as files.
    ...(entry.modified !== undefined ? { modified: new Date(entry.modified) } : {}),
  }));
}

async function remove(instance: StyneInstance, path: string): Promise<void> {
  const reply = await sandboxRequest(instance, 'DELETE', filesPath(instance.id, path));
  expectStatus(reply, `remove ${path}`, [200, 204, 404]);
}

const shellFs = (instance: StyneInstance) =>
  new ShellFileSystem((command, options) => runCommand(instance, command, options));

// ---- snapshots ----

interface SnapshotRecord {
  snapshotID: string;
  name?: string;
  names?: string[];
  sandboxID?: string;
  templateID?: string;
  created?: number;
  sizeBytes?: number;
}

function toSnapshot(record: SnapshotRecord): Snapshot {
  return {
    id: record.name ?? record.names?.[0] ?? record.snapshotID,
    provider: 'styne',
    createdAt: record.created === undefined ? new Date() : new Date(record.created * 1000),
    metadata: {
      snapshotId: record.snapshotID,
      sandboxId: record.sandboxID,
      templateId: record.templateID,
      sizeBytes: record.sizeBytes,
    },
  };
}

async function createSnapshot(client: ClientConfig, instanceId: string, name?: string): Promise<Snapshot> {
  const reply = await sandboxRequest({ client, id: instanceId }, 'POST', sandboxPath(instanceId, '/snapshots'), {
    body: JSON.stringify(name ? { name } : {}),
  });
  expectStatus(reply, 'create snapshot', [200, 201]);
  return toSnapshot(parseJson<SnapshotRecord>(reply, 'create snapshot'));
}

async function listSnapshots(client: ClientConfig, options: ListSnapshotsOptions = {}): Promise<Snapshot[]> {
  const body = await call<SnapshotRecord[] | { snapshots?: SnapshotRecord[] }>(
    client, 'GET', '/snapshots', undefined, 'list snapshots', [200],
  );
  const instanceId = options.instanceId ?? options.sandboxId;
  const snapshots = (Array.isArray(body) ? body : (body.snapshots ?? []))
    .filter((record) => !instanceId || record.sandboxID === instanceId)
    .map(toSnapshot);
  return options.limit === undefined ? snapshots : snapshots.slice(0, options.limit);
}

async function deleteSnapshot(client: ClientConfig, snapshotId: string): Promise<void> {
  const reply = await request(client, 'DELETE', `/snapshots/${encodeURIComponent(snapshotId)}`);
  expectStatus(reply, 'delete snapshot', [200, 204, 404]);
}

// ---- templates ----

interface TemplateRecord {
  templateID: string;
  names?: string[];
  aliases?: string[];
  cpuCount?: number;
  memoryMB?: number;
  diskSizeMB?: number;
  createdAt?: string;
}

function builtinTemplate(record: TemplateRecord): StyneTemplate {
  const name = record.names?.[0] ?? record.aliases?.[0] ?? record.templateID;
  return {
    id: name,
    name,
    provider: 'styne',
    builtin: true,
    createdAt: record.createdAt ? new Date(record.createdAt) : new Date(0),
    metadata: { templateId: record.templateID, cpuCount: record.cpuCount, memoryMB: record.memoryMB, diskSizeMB: record.diskSizeMB },
  };
}

function savedTemplate(snapshot: Snapshot): StyneTemplate {
  return {
    id: snapshot.id,
    name: snapshot.id,
    provider: 'styne',
    builtin: false,
    createdAt: snapshot.createdAt,
    metadata: snapshot.metadata,
  };
}

/**
 * Starts a sandbox from the image or template, saves it as a named snapshot and destroys the sandbox.
 * A failed destroy does not fail the call: the template is saved, and the sandbox ends at its lifetime.
 */
async function createTemplate(config: StyneConfig, options: StyneTemplateOptions): Promise<StyneTemplate> {
  const name = options.name?.trim();
  if (!name) throw new Error('A Styne template needs a name.');
  const client = resolveConfig(config);
  const source = await createSandbox(config, {
    image: options.image,
    templateId: options.image ? undefined : options.templateId,
    metadata: options.metadata,
  });
  try {
    return savedTemplate(await createSnapshot(client, source.id, name));
  } finally {
    await destroySandbox(client, source.id).catch(() => undefined);
  }
}

async function listTemplates(config: StyneConfig, options: ListTemplatesOptions = {}): Promise<StyneTemplate[]> {
  const client = resolveConfig(config);
  const [builtin, saved] = await Promise.all([
    call<TemplateRecord[]>(client, 'GET', '/templates', undefined, 'list templates', [200]),
    listSnapshots(client),
  ]);
  const templates = [...builtin.map(builtinTemplate), ...saved.map(savedTemplate)];
  return options.limit === undefined ? templates : templates.slice(0, options.limit);
}

async function deleteTemplate(config: StyneConfig, templateId: string): Promise<void> {
  const client = resolveConfig(config);
  const saved = await listSnapshots(client);
  if (!saved.some((snapshot) => snapshot.id === templateId)) {
    throw new Error(`Styne template "${templateId}" is not a template saved by this account; built-in templates cannot be deleted.`);
  }
  await deleteSnapshot(client, templateId);
}

// ---- volumes ----

interface VolumeRecord {
  volumeID: string;
  name: string;
  sizeMB?: number;
  region?: string;
  state?: string;
}

function toVolume(record: VolumeRecord): Volume {
  return { id: record.volumeID, name: record.name, sizeMB: record.sizeMB, region: record.region, state: record.state, native: record };
}

async function createVolume(config: StyneConfig, options: CreateVolumeOptions): Promise<Volume> {
  const body: Record<string, unknown> = { name: options.name };
  if (options.sizeBytes !== undefined) body.sizeBytes = options.sizeBytes;
  if (typeof options.region === 'string') body.region = options.region;
  return toVolume(await call<VolumeRecord>(resolveConfig(config), 'POST', '/volumes', body, 'create volume'));
}

async function getVolume(config: StyneConfig, idOrName: string): Promise<Volume | null> {
  const reply = await request(resolveConfig(config), 'GET', `/volumes/${encodeURIComponent(idOrName)}`);
  if (reply.status === 404) return null;
  expectStatus(reply, 'read volume', [200]);
  return toVolume(JSON.parse(reply.body.toString('utf8')) as VolumeRecord);
}

async function listVolumes(config: StyneConfig, options: ListVolumesOptions = {}): Promise<Volume[]> {
  const records = await call<VolumeRecord[]>(resolveConfig(config), 'GET', '/volumes', undefined, 'list volumes', [200]);
  const volumes = records.map(toVolume);
  return options.limit === undefined ? volumes : volumes.slice(0, options.limit);
}

/** Deletes a volume. A volume is released shortly after the sandbox holding it is destroyed, so `409` is retried for a while. */
async function deleteVolume(config: StyneConfig, idOrName: string): Promise<void> {
  const client = resolveConfig(config);
  const deadline = Date.now() + VOLUME_RELEASE_WAIT_MS;
  for (;;) {
    const reply = await request(client, 'DELETE', `/volumes/${encodeURIComponent(idOrName)}`);
    if (reply.status === 409 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    expectStatus(reply, 'delete volume', [200, 204, 404]);
    return;
  }
}

// ---- provider ----

/** Every sandbox of the account: `GET /sandboxes` answers in pages, each naming the next in `x-next-token`. */
async function listSandboxes(client: ClientConfig): Promise<SandboxRecord[]> {
  const records: SandboxRecord[] = [];
  const seen = new Set<string>();
  for (let next: string | undefined; ; ) {
    const reply = await request(client, 'GET', next === undefined ? '/sandboxes' : `/sandboxes?nextToken=${encodeURIComponent(next)}`);
    expectStatus(reply, 'list sandboxes', [200]);
    records.push(...parseJson<SandboxRecord[]>(reply, 'list sandboxes'));
    const token = reply.headers['x-next-token'];
    if (typeof token !== 'string' || token === '') return records;
    if (seen.has(token)) throw new StyneApiError(reply.status, `Styne list sandboxes named page ${token} twice`);
    seen.add(token);
    next = token;
  }
}

async function destroySandbox(client: ClientConfig, id: string): Promise<void> {
  const reply = await sandboxRequest({ client, id }, 'DELETE', sandboxPath(id));
  expectStatus(reply, 'destroy sandbox', [200, 204, 404, 410]);
  forgetRoute(client, id);
}

const defineStyne = defineProvider<StyneInstance, StyneConfig, StyneTemplate, Snapshot>({
  name: 'styne',
  // A sandbox is a clone of its template, so it has the template's size: `size` picks one of the four standard
  // templates, and a snapshot, an image or another template keeps the size it was made with.
  sizes: (_config, profile, options) => {
    if (options?.size !== undefined) throw new InstanceSizeError('conflict', 'cannot combine sizeClass with the native Styne size');
    const raw = sizeFieldsIn(options);
    if (raw.length > 0) throw new InstanceSizeError('conflict', `cannot combine sizeClass with ${raw.join(', ')}`);
    const fixed = options?.snapshotId !== undefined ? 'snapshotId' : options?.image !== undefined ? 'image' : options?.templateId !== undefined ? 'templateId' : undefined;
    if (fixed) {
      return {
        status: 'unsupported',
        reason: `A Styne sandbox started from a ${fixed} keeps the size it was made with; drop ${fixed} to create a standard size.`,
      };
    }
    const shape = STYNE_SIZE_SHAPES[profile.sizeClass];
    if (!shape) {
      return {
        status: 'unsupported',
        reason: profile.vcpus > 16
          ? 'The largest Styne size is xlarge, 16 vCPU / 32 GiB.'
          : 'The smallest Styne size is small, 2 vCPU / 4 GiB; Styne has no 1-vCPU size.',
      };
    }
    return {
      status: 'supported',
      nativeOptions: { size: shape.size },
      resolved: { vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: shape.diskMiB },
    };
  },
  methods: {
    instances: {
      create: async (config, options) => {
        const instance = await createSandbox(config, options);
        return { instance, instanceId: instance.id };
      },

      getById: async (config, instanceId) => {
        const client = resolveConfig(config);
        const record = await readSandbox({ client, id: instanceId });
        return record ? { instance: toInstance(client, record), instanceId } : null;
      },

      list: async (config) => {
        const client = resolveConfig(config);
        const records = await listSandboxes(client);
        return records.map((record) => {
          const instance = toInstance(client, record);
          return { instance, instanceId: instance.id };
        });
      },

      destroy: (config, instanceId) => destroySandbox(resolveConfig(config), instanceId),

      runCommand: (instance, command, options) => runCommand(instance, command, options),

      // Output arrives as the command writes it, so live callbacks are served natively.
      streamCommand: (instance, command, options) => runCommand(instance, command, options),

      getInfo: async (instance) => toInfo(instance.id, await readSandbox(instance)),

      getUrl: async (instance, options) => {
        const domain = instance.domain ?? (await readSandbox(instance))?.domain;
        if (!domain) throw new Error(`Styne sandbox ${instance.id} has no domain for port URLs.`);
        return `${options.protocol ?? 'https'}://${options.port}-${instance.id}.${domain}`;
      },

      getInstance: (instance) => instance,

      pause: async (instance) => {
        const reply = await sandboxRequest(instance, 'POST', sandboxPath(instance.id, '/pause'), {
          body: JSON.stringify({ tier: 'memory' }),
        });
        // The API answers a pause of a paused sandbox with 409 `already_paused`: nothing changed.
        if (reply.status === 409 && errorCodeOf(reply) === 'already_paused') return;
        expectStatus(reply, 'pause sandbox', [200, 204]);
      },

      // Without a body the API gives the sandbox the lifetime it was created with again.
      resume: async (instance) => {
        const reply = await sandboxRequest(instance, 'POST', sandboxPath(instance.id, '/resume'));
        if (reply.status === 409 && errorCodeOf(reply) === 'already_running') return;
        expectStatus(reply, 'resume sandbox', [200, 201]);
      },

      pauseCapabilities: { memory: true },

      lifetime: { defaultMs: DEFAULT_LIFETIME_MS, maxMs: MAX_LIFETIME_MS },

      // `/refreshes` keeps the sandbox alive for at least `duration` more seconds and never shortens its life.
      extendLifetime: async (instance, ms) => {
        const reply = await sandboxRequest(instance, 'POST', sandboxPath(instance.id, '/refreshes'), {
          body: JSON.stringify({ duration: Math.ceil(Math.min(ms, MAX_LIFETIME_MS) / 1000) }),
        });
        expectStatus(reply, 'extend sandbox lifetime', [200, 204]);
      },

      filesystem: {
        readFile: (instance, path) => readFile(instance, path),
        writeFile: (instance, path, content) => writeFile(instance, path, content),
        mkdir: (instance, path) => shellFs(instance).mkdir(path),
        readdir: (instance, path) => readdir(instance, path),
        exists: (instance, path) => shellFs(instance).exists(path),
        remove: (instance, path) => remove(instance, path),
      },
    },

    template: {
      create: (config, options) => createTemplate(config, options as StyneTemplateOptions),
      list: (config, options) => listTemplates(config, options),
      delete: (config, templateId) => deleteTemplate(config, templateId),
    },

    snapshot: {
      // Snapshots keep memory, processes and the root filesystem; the source keeps running.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false, fork: true },
      create: (config, instanceId, options?: CreateSnapshotOptions) =>
        createSnapshot(resolveConfig(config), instanceId, options?.name),
      list: (config, options) => listSnapshots(resolveConfig(config), options),
      delete: (config, snapshotId) => deleteSnapshot(resolveConfig(config), snapshotId),
    },

    volume: {
      create: createVolume,
      get: getVolume,
      list: listVolumes,
      delete: deleteVolume,
    },
  },
});

/**
 * Creates a Styne provider. A create sized with the universal `vcpus`, `memoryMiB` or `diskMiB` fields gets the
 * Styne size that has them, or an `InstanceSizeError` before any sandbox starts.
 */
export const styne = defineStyne;

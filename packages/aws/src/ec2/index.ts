/**
 * AWS EC2 Provider - Factory-based Implementation
 *
 * Launches one EC2 instance per sandbox from a launch template and runs commands
 * with SSM Run Command (`AWS-RunShellScript`). A plain on-demand launch uses
 * RunInstances; Spot or multi-type/multi-subnet launches use an instant EC2
 * Fleet. Nothing listens on the box: the SSM agent dials out.
 */

import { randomUUID } from 'node:crypto';
import {
  CreateFleetCommand,
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  paginateDescribeInstances,
  type CreateFleetError,
  type FleetLaunchTemplateOverridesRequest,
  type FleetLaunchTemplateSpecificationRequest,
  type Instance as Ec2Instance,
  type LaunchTemplateSpecification,
  type Tag,
} from '@aws-sdk/client-ec2';
import {
  CancelCommandCommand,
  DescribeInstanceInformationCommand,
  GetCommandInvocationCommand,
  SSMClient,
  SendCommandCommand,
  type GetCommandInvocationCommandOutput,
} from '@aws-sdk/client-ssm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, InstanceInfo, RunCommandOptions } from 'computesdk';

const PROVIDER = 'aws-ec2';

export const MANAGED_TAG_KEY = 'computesdk:managed';
export const SANDBOX_NAME_TAG_KEY = 'computesdk:sandbox-name';

const DEFAULT_LAUNCH_TEMPLATE_VERSION = '$Default';
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 10_000;
/** How long GetCommandInvocation may keep answering InvocationDoesNotExist after SendCommand. */
const INVOCATION_REGISTRATION_GRACE_MS = 30_000;
/** Client-side slack on top of the SSM execution timeout before cancelling. */
const COMMAND_DEADLINE_SLACK_MS = 60_000;
/** SSM's own default executionTimeout for AWS-RunShellScript. */
const DEFAULT_EXECUTION_TIMEOUT_S = 3_600;
/** GetCommandInvocation returns at most this many characters per stream. */
export const SSM_INLINE_OUTPUT_LIMIT = 24_000;
/** SSM returns only the first 8,000 characters of stderr inline. */
export const SSM_INLINE_STDERR_LIMIT = 8_000;
export const SPILL_MARKER = '__COMPUTESDK_SPILL__';
const SPILL_DIR = '/tmp/computesdk-ssm';
/** 17,000 bytes base64-encode to 22,668 characters, under the inline limit. */
const READBACK_CHUNK_BYTES = 17_000;
const READBACK_CONCURRENCY = 4;
const READBACK_TIMEOUT_S = 120;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TAGS_PER_RESOURCE = 50;
const MAX_TAG_KEY_LENGTH = 128;
const MAX_TAG_VALUE_LENGTH = 256;

/** EC2 Fleet error codes that mean "no box right now", not "bad request". */
export const CAPACITY_ERROR_CODES: ReadonlySet<string> = new Set([
  'InsufficientInstanceCapacity',
  'InsufficientCapacity',
  'InsufficientHostCapacity',
  'InsufficientReservedInstanceCapacity',
  'InsufficientFreeAddressesInSubnet',
  'SpotMaxPriceTooLow',
  'MaxSpotInstanceCountExceeded',
  'MaxSpotFleetRequestCountExceeded',
  'InstanceLimitExceeded',
  'VcpuLimitExceeded',
  'UnfulfillableCapacity',
]);

export interface Ec2SpotOptions {
  /** Max total Spot price per hour, e.g. "0.05". */
  maxPricePerHour?: string;
}

export interface Ec2Config {
  /** Launch template name or id (`lt-...`). It owns AMI, IMDS, root volume, security group, networking, and instance profile. */
  launchTemplate: string;
  /** Launch template version (default "$Default"). */
  launchTemplateVersion?: string;
  /** AWS region, e.g. "us-east-2". Falls back to AWS_REGION. */
  region?: string;
  /** Instance type, or a list the fleet may pick from. Default: the launch template's. */
  instanceType?: string | string[];
  /** Subnets to launch into, one per AZ. Default: the launch template's. */
  subnetIds?: string[];
  /** Launch Spot capacity instead of on-demand (default). */
  spot?: boolean | Ec2SpotOptions;
  /** Static credentials or a provider function. Omit to use the default AWS SDK credential chain. */
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  /** How long `create` waits for the instance to come Online in SSM (default 120000). */
  readyTimeoutMs?: number;
  /** Base poll interval for SSM readiness and command status (default 2000). */
  pollIntervalMs?: number;
  /** S3 bucket for full command output; without it stdout/stderr are truncated to 24,000 characters each. */
  outputS3Bucket?: string;
  /** Key prefix inside `outputS3Bucket`. */
  outputS3KeyPrefix?: string;
  /**
   * Without `outputS3Bucket`, output past SSM's 24,000-character inline limit is spilled to files on the instance
   * and read back in chunks. Each stream keeps at most its last `maxOutputBytes` bytes (default 4 MiB).
   */
  maxOutputBytes?: number;
  /**
   * Ingress seam: resolves a public URL for a port on the instance. EC2 boxes accept no inbound
   * traffic, so without this `getUrl` throws; an ingress layer (e.g. a tunnel the box dials out
   * to) plugs in here.
   */
  getUrl?: (sandbox: Ec2Sandbox, options: { port: number; protocol?: string }) => Promise<string>;
}

export type Ec2Lifecycle = 'spot' | 'on-demand';

/** Native sandbox handle exposed via `getInstance()`. */
export interface Ec2Sandbox {
  instanceId: string;
  region: string;
  instanceType?: string;
  availabilityZone?: string;
  subnetId?: string;
  lifecycle: Ec2Lifecycle;
  launchTime: Date;
  state: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  tags: Record<string, string>;
}

export interface Ec2FleetErrorDetail {
  code?: string;
  message?: string;
  instanceType?: string;
  subnetId?: string;
  availabilityZone?: string;
}

/** The launch produced no instance. `errors` holds the AWS errors (one per fleet override). */
export class Ec2FleetError extends Error {
  readonly errors: Ec2FleetErrorDetail[];
  constructor(message: string, errors: Ec2FleetErrorDetail[]) {
    super(message);
    this.name = 'Ec2FleetError';
    this.errors = errors;
  }
  get codes(): string[] {
    return [...new Set(this.errors.map((error) => error.code).filter((code): code is string => !!code))];
  }
}

/** No capacity (or quota/price headroom) across the configured instance types and subnets. */
export class Ec2CapacityError extends Ec2FleetError {
  readonly code = 'AWS_EC2_CAPACITY_UNAVAILABLE';
  constructor(message: string, errors: Ec2FleetErrorDetail[]) {
    super(message, errors);
    this.name = 'Ec2CapacityError';
  }
}

/** The instance launched but never came Online in SSM; it has been terminated. */
export class Ec2ReadyTimeoutError extends Error {
  constructor(readonly instanceId: string, readonly timeoutMs: number) {
    super(`EC2 instance ${instanceId} did not come Online in SSM within ${timeoutMs}ms; it was terminated.`);
    this.name = 'Ec2ReadyTimeoutError';
  }
}

/** Works across bundle copies where `instanceof` does not. */
export function isEc2CapacityError(error: unknown): error is Ec2CapacityError {
  return error instanceof Ec2CapacityError || (error instanceof Error && error.name === 'Ec2CapacityError');
}

interface Clients {
  ec2: EC2Client;
  ssm: SSMClient;
  s3?: S3Client;
}

interface Context {
  config: Ec2Config;
  region: string;
  clients: Clients;
}

const clientCache = new WeakMap<Ec2Config, Context>();
/** Keeps clients/credentials off the public `getInstance()` object. */
const sandboxContexts = new WeakMap<Ec2Sandbox, Context>();

function resolveRegion(config: Ec2Config): string {
  const region = config.region ?? process.env.AWS_REGION;
  if (!region) {
    throw new Error(
      'Missing AWS region for aws-ec2.\n\n' +
      'Pass it: ec2({ region: "us-east-2", ... })\n' +
      'Or set AWS_REGION in your environment.'
    );
  }
  return region;
}

function contextFor(config: Ec2Config): Context {
  const cached = clientCache.get(config);
  if (cached) return cached;
  const region = resolveRegion(config);
  const clientConfig = { region, ...(config.credentials ? { credentials: config.credentials } : {}) };
  const context: Context = {
    config,
    region,
    clients: {
      ec2: new EC2Client(clientConfig),
      ssm: new SSMClient(clientConfig),
      ...(config.outputS3Bucket ? { s3: new S3Client(clientConfig) } : {}),
    },
  };
  clientCache.set(config, context);
  return context;
}

function contextForSandbox(sandbox: Ec2Sandbox): Context {
  const context = sandboxContexts.get(sandbox);
  if (!context) throw new Error(`aws-ec2 client state is unavailable for instance ${sandbox.instanceId}.`);
  return context;
}

function validateLaunchConfig(config: Ec2Config): void {
  if (!config.launchTemplate) {
    throw new Error(
      'Missing aws-ec2 config: launchTemplate.\n\n' +
      'Pass it: ec2({ launchTemplate: "my-template" })'
    );
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { name, Code, code } = error as { name?: string; Code?: string; code?: string };
  return Code ?? code ?? name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInstanceNotFound(error: unknown): boolean {
  const name = errorName(error);
  return name === 'InvalidInstanceID.NotFound' || name === 'InvalidInstanceID.Malformed';
}

const TAG_DISALLOWED = /[^\p{L}\p{N}\s+\-=._:/@]/gu;

function sanitizeTagKey(key: string): string {
  return key.replace(TAG_DISALLOWED, '_').slice(0, MAX_TAG_KEY_LENGTH);
}

function sanitizeTagValue(value: string): string {
  return value.replace(TAG_DISALLOWED, '_').slice(0, MAX_TAG_VALUE_LENGTH);
}

/** Tags stamped on the instance and its volumes. The managed tag always wins. */
export function buildTags(options?: CreateInstanceOptions): Tag[] {
  const tags = new Map<string, string>();
  tags.set(MANAGED_TAG_KEY, 'true');
  if (options?.name) tags.set(SANDBOX_NAME_TAG_KEY, sanitizeTagValue(String(options.name)));
  for (const [rawKey, rawValue] of Object.entries(options?.metadata ?? {})) {
    if (tags.size >= MAX_TAGS_PER_RESOURCE) break;
    if (typeof rawValue !== 'string') continue;
    const key = sanitizeTagKey(rawKey);
    if (!key.trim() || key.toLowerCase().startsWith('aws:') || tags.has(key)) continue;
    tags.set(key, sanitizeTagValue(rawValue));
  }
  return [...tags].map(([Key, Value]) => ({ Key, Value }));
}

export function instanceTypesOf(config: Ec2Config): string[] {
  const { instanceType } = config;
  return (Array.isArray(instanceType) ? instanceType : instanceType ? [instanceType] : []).filter(Boolean);
}

export function spotOptionsOf(config: Ec2Config): Ec2SpotOptions | undefined {
  if (!config.spot) return undefined;
  return config.spot === true ? {} : config.spot;
}

/** Fleet is only needed for Spot or to fall back across several instance types/subnets. */
export function usesFleet(config: Ec2Config): boolean {
  return !!spotOptionsOf(config) || instanceTypesOf(config).length > 1 || (config.subnetIds?.length ?? 0) > 0;
}

/** Instance type x subnet product; a missing dimension falls back to the launch template's value. */
export function buildOverrides(config: Ec2Config): FleetLaunchTemplateOverridesRequest[] {
  const types: Array<string | undefined> = instanceTypesOf(config);
  const subnets: Array<string | undefined> = config.subnetIds?.length ? config.subnetIds : [];
  if (!types.length && !subnets.length) return [];
  return (types.length ? types : [undefined]).flatMap((InstanceType) =>
    (subnets.length ? subnets : [undefined]).map((SubnetId) => ({
      ...(InstanceType ? { InstanceType: InstanceType as FleetLaunchTemplateOverridesRequest['InstanceType'] } : {}),
      ...(SubnetId ? { SubnetId } : {}),
    }))
  );
}

function launchTemplateSpec(config: Ec2Config): LaunchTemplateSpecification & FleetLaunchTemplateSpecificationRequest {
  const Version = config.launchTemplateVersion ?? DEFAULT_LAUNCH_TEMPLATE_VERSION;
  return /^lt-[0-9a-f]+$/.test(config.launchTemplate)
    ? { LaunchTemplateId: config.launchTemplate, Version }
    : { LaunchTemplateName: config.launchTemplate, Version };
}

function fleetErrorDetail(error: CreateFleetError): Ec2FleetErrorDetail {
  const overrides = error.LaunchTemplateAndOverrides?.Overrides;
  return {
    code: error.ErrorCode,
    message: error.ErrorMessage,
    instanceType: overrides?.InstanceType,
    subnetId: overrides?.SubnetId,
    availabilityZone: overrides?.AvailabilityZone,
  };
}

function tagsToRecord(tags: Tag[] | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  for (const tag of tags ?? []) {
    if (tag.Key) record[tag.Key] = tag.Value ?? '';
  }
  return record;
}

function isManaged(instance: Ec2Instance): boolean {
  return (instance.Tags ?? []).some((tag) => tag.Key === MANAGED_TAG_KEY && tag.Value === 'true');
}

function isGone(instance: Ec2Instance): boolean {
  const state = instance.State?.Name;
  return state === 'terminated' || state === 'shutting-down';
}

function sandboxFromEc2(context: Context, instance: Ec2Instance): Ec2Sandbox {
  const sandbox: Ec2Sandbox = {
    instanceId: instance.InstanceId!,
    region: context.region,
    instanceType: instance.InstanceType,
    availabilityZone: instance.Placement?.AvailabilityZone,
    subnetId: instance.SubnetId,
    lifecycle: instance.InstanceLifecycle === 'spot' ? 'spot' : 'on-demand',
    launchTime: instance.LaunchTime ? new Date(instance.LaunchTime) : new Date(),
    state: instance.State?.Name ?? 'unknown',
    privateIpAddress: instance.PrivateIpAddress,
    publicIpAddress: instance.PublicIpAddress,
    tags: tagsToRecord(instance.Tags),
  };
  sandboxContexts.set(sandbox, context);
  return sandbox;
}

async function describeInstance(context: Context, instanceId: string): Promise<Ec2Instance | null> {
  try {
    const result = await context.clients.ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    return result.Reservations?.flatMap((reservation) => reservation.Instances ?? [])
      .find((instance) => instance.InstanceId === instanceId) ?? null;
  } catch (error) {
    if (isInstanceNotFound(error)) return null;
    throw error;
  }
}

async function terminate(context: Context, instanceId: string): Promise<void> {
  try {
    await context.clients.ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
  } catch (error) {
    if (!isInstanceNotFound(error)) throw error;
  }
}

function tagSpecifications(options?: CreateInstanceOptions) {
  const tags = buildTags(options);
  return [
    { ResourceType: 'instance' as const, Tags: tags },
    { ResourceType: 'volume' as const, Tags: tags },
  ];
}

async function launchWithRunInstances(context: Context, options?: CreateInstanceOptions): Promise<string> {
  const { config } = context;
  const [instanceType] = instanceTypesOf(config);
  try {
    const result = await context.clients.ec2.send(new RunInstancesCommand({
      ClientToken: randomUUID(),
      MinCount: 1,
      MaxCount: 1,
      LaunchTemplate: launchTemplateSpec(config),
      ...(instanceType ? { InstanceType: instanceType as FleetLaunchTemplateOverridesRequest['InstanceType'] } : {}),
      TagSpecifications: tagSpecifications(options),
    }));
    const instanceId = result.Instances?.[0]?.InstanceId;
    if (!instanceId) throw new Ec2FleetError('EC2 RunInstances launched no instance.', []);
    return instanceId;
  } catch (error) {
    const code = errorName(error);
    if (code && CAPACITY_ERROR_CODES.has(code)) {
      const detail = { code, message: (error as Error).message, instanceType };
      throw new Ec2CapacityError(`No EC2 capacity for ${config.launchTemplate} (${code}).`, [detail]);
    }
    throw error;
  }
}

async function launchWithFleet(context: Context, options?: CreateInstanceOptions): Promise<string> {
  const { config } = context;
  const spot = spotOptionsOf(config);
  const overrides = buildOverrides(config);
  const result = await context.clients.ec2.send(new CreateFleetCommand({
    Type: 'instant',
    ClientToken: randomUUID(),
    TargetCapacitySpecification: { TotalTargetCapacity: 1, DefaultTargetCapacityType: spot ? 'spot' : 'on-demand' },
    ...(spot ? {
      SpotOptions: {
        AllocationStrategy: 'price-capacity-optimized',
        ...(spot.maxPricePerHour ? { MaxTotalPrice: spot.maxPricePerHour } : {}),
      },
    } : {}),
    LaunchTemplateConfigs: [{
      LaunchTemplateSpecification: launchTemplateSpec(config),
      ...(overrides.length ? { Overrides: overrides } : {}),
    }],
    TagSpecifications: tagSpecifications(options),
  }));

  const launched = result.Instances?.find((entry) => entry.InstanceIds?.length);
  const instanceId = launched?.InstanceIds?.[0];
  if (!launched || !instanceId) {
    const errors = (result.Errors ?? []).map(fleetErrorDetail);
    const codes = [...new Set(errors.map((error) => error.code).filter(Boolean))];
    const summary = codes.length ? codes.join(', ') : 'no error reported';
    if (errors.length === 0 || errors.every((error) => error.code && CAPACITY_ERROR_CODES.has(error.code))) {
      throw new Ec2CapacityError(`No EC2 ${spot ? 'Spot ' : ''}capacity for ${config.launchTemplate} (${summary}).`, errors);
    }
    throw new Ec2FleetError(`EC2 CreateFleet launched no instance (${summary}).`, errors);
  }

  // Instant fleets can return extra instances on retries of the same token; keep only the first.
  const extras = result.Instances?.flatMap((entry) => entry.InstanceIds ?? []).filter((id) => id !== instanceId) ?? [];
  for (const extra of extras) await terminate(context, extra).catch(() => {});

  return instanceId;
}

function launchInstance(context: Context, options?: CreateInstanceOptions): Promise<string> {
  return usesFleet(context.config) ? launchWithFleet(context, options) : launchWithRunInstances(context, options);
}

async function waitForSsmOnline(context: Context, instanceId: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let interval = context.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  while (true) {
    signal?.throwIfAborted();
    const result = await context.clients.ssm.send(new DescribeInstanceInformationCommand({
      Filters: [{ Key: 'InstanceIds', Values: [instanceId] }],
    }));
    if (result.InstanceInformationList?.some((info) => info.InstanceId === instanceId && info.PingStatus === 'Online')) {
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Ec2ReadyTimeoutError(instanceId, timeoutMs);
    await sleep(Math.min(interval, remaining));
    interval = Math.min(interval * 1.5, MAX_POLL_INTERVAL_MS);
  }
}

async function createSandbox(config: Ec2Config, options?: CreateInstanceOptions) {
  validateLaunchConfig(config);
  const context = contextFor(config);
  options?.signal?.throwIfAborted();

  const instanceId = await launchInstance(context, options);
  const timeoutMs = options?.timeout ?? config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  try {
    await waitForSsmOnline(context, instanceId, timeoutMs, options?.signal);
    const described = await describeInstance(context, instanceId);
    if (!described || isGone(described)) {
      throw new Error(`EC2 instance ${instanceId} terminated before it was ready (state: ${described?.State?.Name ?? 'not found'}).`);
    }
    return { instance: sandboxFromEc2(context, described), instanceId };
  } catch (error) {
    try {
      await terminate(context, instanceId);
    } catch (cleanupError) {
      if (error instanceof Error) {
        error.message += ` (cleanup also failed; ${instanceId} may still be running: ${errorMessage(cleanupError)})`;
        Object.assign(error, { cleanupError });
      }
    }
    throw error;
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The single shell script handed to AWS-RunShellScript. */
const HOME_DEFAULT =
  'if [ -z "${HOME:-}" ]; then HOME=$(getent passwd "$(id -u)" | cut -d: -f6); export HOME="${HOME:-/root}"; fi';

export function buildScript(command: string, options?: RunCommandOptions): string {
  // SSM's agent runs commands with no HOME; tools like act refuse to start without one.
  const lines: string[] = [HOME_DEFAULT];
  for (const [key, value] of Object.entries(options?.env ?? {})) {
    if (!ENV_NAME.test(key)) throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}`);
    lines.push(`export ${key}="${escapeShellArg(value)}"`);
  }
  if (options?.cwd) lines.push(`cd "${escapeShellArg(options.cwd)}" || exit 1`);
  if (options?.background) {
    const quoted = `'${command.replace(/'/g, `'\\''`)}'`;
    lines.push(`nohup /bin/sh -c ${quoted} >/dev/null 2>&1 &`);
  } else {
    lines.push(command);
  }
  return lines.join('\n');
}

const TERMINAL_STATUSES = new Set(['Success', 'Failed', 'TimedOut', 'Cancelled']);

/** S3 key the SSM agent writes for AWS-RunShellScript output. */
export function outputS3Key(prefix: string | undefined, commandId: string, instanceId: string, stream: 'stdout' | 'stderr'): string {
  const base = `${commandId}/${instanceId}/awsrunShellScript/0.awsrunShellScript/${stream}`;
  const trimmed = prefix?.replace(/\/+$/, '');
  return trimmed ? `${trimmed}/${base}` : base;
}

async function readS3Output(context: Context, key: string, fallback: string): Promise<string> {
  const { s3, } = context.clients;
  if (!s3 || !context.config.outputS3Bucket) return fallback;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: context.config.outputS3Bucket, Key: key }));
    return (await object.Body?.transformToString('utf-8')) ?? fallback;
  } catch (error) {
    if (errorName(error) === 'NoSuchKey') return fallback;
    throw error;
  }
}

function exitCodeFor(invocation: GetCommandInvocationCommandOutput): number {
  const code = invocation.ResponseCode;
  switch (invocation.Status) {
    case 'Success':
      return code !== undefined && code >= 0 ? code : 0;
    case 'TimedOut':
      return 124;
    case 'Cancelled':
      return code !== undefined && code > 0 ? code : 130;
    default:
      return code !== undefined && code > 0 ? code : 1;
  }
}

/**
 * Runs `script` with stdout/stderr redirected to files. Small output is printed as usual and the files removed;
 * output over the inline limits (24,000 stdout / 8,000 stderr) stays on disk and only `SPILL_MARKER <stdoutBytes> <stderrBytes>` is printed.
 */
export function spillScript(script: string, id: string): string {
  const out = `${SPILL_DIR}/${id}.out`;
  const err = `${SPILL_DIR}/${id}.err`;
  return [
    `mkdir -p ${SPILL_DIR} && chmod 700 ${SPILL_DIR}`,
    '(',
    script,
    `) >${out} 2>${err}`,
    '__csdk_rc=$?',
    `__csdk_so=$(wc -c <${out} | tr -d ' '); __csdk_se=$(wc -c <${err} | tr -d ' ')`,
    `if [ "$__csdk_so" -le ${SSM_INLINE_OUTPUT_LIMIT} ] && [ "$__csdk_se" -le ${SSM_INLINE_STDERR_LIMIT} ]; then`,
    `  cat ${out}; cat ${err} >&2; rm -f ${out} ${err}`,
    'else',
    `  echo "${SPILL_MARKER} $__csdk_so $__csdk_se"`,
    'fi',
    'exit $__csdk_rc',
  ].join('\n');
}

interface SsmRun {
  commandId: string;
  invocation: GetCommandInvocationCommandOutput;
}

/** SendCommand + poll to a terminal status; cancels when it never registers or outlives the client deadline. */
async function ssmRun(
  context: Context,
  sandbox: Ec2Sandbox,
  script: string,
  executionTimeoutS: number | undefined,
): Promise<SsmRun> {
  const { config, clients } = context;
  const startedAt = Date.now();
  const sent = await clients.ssm.send(new SendCommandCommand({
    DocumentName: 'AWS-RunShellScript',
    InstanceIds: [sandbox.instanceId],
    Parameters: {
      commands: [script],
      ...(executionTimeoutS ? { executionTimeout: [String(executionTimeoutS)] } : {}),
    },
    ...(config.outputS3Bucket ? { OutputS3BucketName: config.outputS3Bucket } : {}),
    ...(config.outputS3Bucket && config.outputS3KeyPrefix ? { OutputS3KeyPrefix: config.outputS3KeyPrefix } : {}),
  }));
  const commandId = sent.Command?.CommandId;
  if (!commandId) throw new Error(`SSM SendCommand returned no CommandId for ${sandbox.instanceId}.`);

  const deadline = startedAt + (executionTimeoutS ?? DEFAULT_EXECUTION_TIMEOUT_S) * 1000 + COMMAND_DEADLINE_SLACK_MS;
  const registrationDeadline = startedAt + INVOCATION_REGISTRATION_GRACE_MS;
  const basePoll = Math.min(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 1_000);
  let interval = Math.max(1, Math.min(basePoll, 250));

  const cancel = () =>
    clients.ssm.send(new CancelCommandCommand({ CommandId: commandId, InstanceIds: [sandbox.instanceId] })).catch(() => {});

  while (true) {
    try {
      const invocation = await clients.ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: sandbox.instanceId }));
      if (invocation.Status && TERMINAL_STATUSES.has(invocation.Status)) return { commandId, invocation };
    } catch (error) {
      if (errorName(error) !== 'InvocationDoesNotExist') throw error;
      if (Date.now() > registrationDeadline) {
        await cancel();
        throw error;
      }
    }
    if (Date.now() > deadline) {
      await cancel();
      throw new Error(`SSM command ${commandId} on ${sandbox.instanceId} did not finish before the client deadline; it was cancelled.`);
    }
    await sleep(interval);
    interval = Math.min(interval * 1.5, basePoll);
  }
}

async function ssmRunOk(context: Context, sandbox: Ec2Sandbox, script: string, what: string): Promise<GetCommandInvocationCommandOutput> {
  const { invocation } = await ssmRun(context, sandbox, script, READBACK_TIMEOUT_S);
  if (invocation.Status !== 'Success') {
    const detail = (invocation.StandardErrorContent ?? '').trim().slice(-400);
    throw new Error(`aws-ec2: ${what} failed on ${sandbox.instanceId} (${invocation.Status})${detail ? `: ${detail}` : ''}`);
  }
  return invocation;
}

async function inParallel<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]!);
  });
  await Promise.all(workers);
}

interface SpilledStream {
  file: string;
  size: number;
  start: number;
  chunks: Buffer[];
}

const chunkRead = (file: string, offset: number) =>
  `tail -c +${offset + 1} ${file} | head -c ${READBACK_CHUNK_BYTES} | base64 | tr -d '\\n'`;

/** Reads spilled output back in base64 chunks, one per SSM command and always on stdout (stderr is capped at 8,000), then deletes it. */
async function readSpilled(
  context: Context,
  sandbox: Ec2Sandbox,
  id: string,
  sizes: { stdout: number; stderr: number },
): Promise<{ stdout: string; stderr: string; notes: string[] }> {
  const max = context.config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stream = (ext: string, size: number): SpilledStream => {
    const start = Math.max(0, size - max);
    return { file: `${SPILL_DIR}/${id}.${ext}`, size, start, chunks: new Array(Math.ceil((size - start) / READBACK_CHUNK_BYTES)) };
  };
  let out: SpilledStream;
  let err: SpilledStream;

  try {
    out = stream('out', sizes.stdout);
    err = stream('err', sizes.stderr);
    const reads = [out, err].flatMap((spilled) => Array.from({ length: spilled.chunks.length }, (_, index) => ({ spilled, index })));
    await inParallel(reads, READBACK_CONCURRENCY, async ({ spilled, index }) => {
      const script = chunkRead(spilled.file, spilled.start + index * READBACK_CHUNK_BYTES);
      const invocation = await ssmRunOk(context, sandbox, script, 'reading back command output');
      spilled.chunks[index] = Buffer.from((invocation.StandardOutputContent ?? '').trim(), 'base64');
    });
  } finally {
    await removeSpilled(context, sandbox, id);
  }

  const notes: string[] = [];
  for (const [name, s] of [['stdout', out], ['stderr', err]] as const) {
    if (s.start > 0) notes.push(`[aws-ec2] ${name} truncated to the last ${s.size - s.start} of ${s.size} bytes (maxOutputBytes)`);
  }
  return { stdout: Buffer.concat(out.chunks).toString('utf8'), stderr: Buffer.concat(err.chunks).toString('utf8'), notes };
}

/** Best effort and not awaited past SendCommand: a cleanup must never fail or delay the caller. */
async function removeSpilled(context: Context, sandbox: Ec2Sandbox, id: string): Promise<void> {
  try {
    await context.clients.ssm.send(new SendCommandCommand({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [sandbox.instanceId],
      Parameters: { commands: [`rm -f ${SPILL_DIR}/${id}.out ${SPILL_DIR}/${id}.err`], executionTimeout: ['60'] },
    }));
  } catch {
    // the instance may already be gone
  }
}

async function spilledSizes(context: Context, sandbox: Ec2Sandbox, id: string): Promise<{ stdout: number; stderr: number }> {
  const size = (ext: string) => `$(wc -c <${SPILL_DIR}/${id}.${ext} 2>/dev/null | tr -d ' ')`;
  const invocation = await ssmRunOk(context, sandbox, `echo "${size('out')} ${size('err')}"`, 'reading output size');
  const [stdout, stderr] = (invocation.StandardOutputContent ?? '').trim().split(/\s+/).map((n) => Number(n) || 0);
  return { stdout: stdout ?? 0, stderr: stderr ?? 0 };
}

async function readSpilledOutput(
  context: Context,
  sandbox: Ec2Sandbox,
  id: string,
  sizes: { stdout: number; stderr: number },
): Promise<{ stdout: string; stderr: string }> {
  const spilled = await readSpilled(context, sandbox, id, sizes);
  let stderr = spilled.stderr;
  for (const note of spilled.notes) stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}${note}`;
  return { stdout: spilled.stdout, stderr };
}

const SPILL_LINE = new RegExp(`^${SPILL_MARKER} (\\d+) (\\d+)$`);

async function runCommand(sandbox: Ec2Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const context = contextForSandbox(sandbox);
  const { config } = context;
  const startedAt = Date.now();
  const executionTimeoutS = options?.timeout ? Math.max(1, Math.ceil(options.timeout / 1000)) : undefined;
  const spillId = !config.outputS3Bucket && !options?.background ? randomUUID() : undefined;
  const script = buildScript(command, options);

  let run: SsmRun;
  try {
    run = await ssmRun(context, sandbox, spillId ? spillScript(script, spillId) : script, executionTimeoutS);
  } catch (error) {
    if (spillId) await removeSpilled(context, sandbox, spillId);
    throw error;
  }
  const { commandId, invocation } = run;

  let stdout = invocation.StandardOutputContent ?? '';
  let stderr = invocation.StandardErrorContent ?? '';
  if (spillId) {
    const marker = SPILL_LINE.exec(stdout.trim());
    // A timed-out script is killed before it prints anything; whatever it wrote is still on disk.
    if (marker) {
      ({ stdout, stderr } = await readSpilledOutput(context, sandbox, spillId, {
        stdout: Number(marker[1]),
        stderr: Number(marker[2]),
      }));
    } else if (invocation.Status === 'TimedOut') {
      // Partial output is best effort: a failed read-back must not hide the timeout itself.
      const sizes = await spilledSizes(context, sandbox, spillId).catch(() => undefined);
      if (!sizes) {
        await removeSpilled(context, sandbox, spillId);
      } else {
        try {
          ({ stdout, stderr } = await readSpilledOutput(context, sandbox, spillId, sizes));
        } catch {
          // keep the (empty) inline output; readSpilled has already removed the files
        }
      }
    } else if (invocation.Status === 'Cancelled') {
      // Cancelled outside this call: the script never reached its own cleanup.
      await removeSpilled(context, sandbox, spillId);
    }
  } else if (config.outputS3Bucket) {
    [stdout, stderr] = await Promise.all([
      stdout.length >= SSM_INLINE_OUTPUT_LIMIT
        ? readS3Output(context, outputS3Key(config.outputS3KeyPrefix, commandId, sandbox.instanceId, 'stdout'), stdout)
        : stdout,
      stderr.length >= SSM_INLINE_STDERR_LIMIT
        ? readS3Output(context, outputS3Key(config.outputS3KeyPrefix, commandId, sandbox.instanceId, 'stderr'), stderr)
        : stderr,
    ]);
  }
  if (invocation.Status === 'TimedOut' && executionTimeoutS) {
    stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}[aws-ec2] command timed out after ${executionTimeoutS}s`;
  }

  return {
    stdout,
    stderr,
    exitCode: exitCodeFor(invocation),
    durationMs: Date.now() - startedAt,
  };
}

function mapStatus(state: string): InstanceInfo['status'] {
  if (state === 'running' || state === 'pending') return 'running';
  if (state === 'stopped' || state === 'stopping') return 'stopped';
  return 'error';
}

export const ec2 = defineProvider<Ec2Sandbox, Ec2Config>({
  name: PROVIDER,
  methods: {
    instances: {
      create: createSandbox,

      getById: async (config, instanceId) => {
        const context = contextFor(config);
        const instance = await describeInstance(context, instanceId);
        if (!instance || isGone(instance) || !isManaged(instance)) return null;
        return { instance: sandboxFromEc2(context, instance), instanceId };
      },

      list: async (config) => {
        const context = contextFor(config);
        const sandboxes: Array<{ instance: Ec2Sandbox; instanceId: string }> = [];
        const pages = paginateDescribeInstances({ client: context.clients.ec2 }, {
          Filters: [
            { Name: `tag:${MANAGED_TAG_KEY}`, Values: ['true'] },
            { Name: 'instance-state-name', Values: ['pending', 'running'] },
          ],
        });
        for await (const page of pages) {
          for (const instance of page.Reservations?.flatMap((reservation) => reservation.Instances ?? []) ?? []) {
            if (!instance.InstanceId) continue;
            sandboxes.push({ instance: sandboxFromEc2(context, instance), instanceId: instance.InstanceId });
          }
        }
        return sandboxes;
      },

      destroy: async (config, instanceId) => {
        const context = contextFor(config);
        const instance = await describeInstance(context, instanceId);
        if (!instance || instance.State?.Name === 'terminated') return;
        if (!isManaged(instance)) {
          throw new Error(`Refusing to terminate ${instanceId}: it is not tagged ${MANAGED_TAG_KEY}=true.`);
        }
        await terminate(context, instanceId);
      },

      runCommand,

      getInfo: async (sandbox) => {
        const context = contextForSandbox(sandbox);
        const current = await describeInstance(context, sandbox.instanceId);
        const state = current?.State?.Name ?? 'terminated';
        sandbox.state = state;
        return {
          id: sandbox.instanceId,
          provider: PROVIDER,
          status: mapStatus(state),
          createdAt: sandbox.launchTime,
          timeout: DEFAULT_EXECUTION_TIMEOUT_S * 1000,
          metadata: {
            region: sandbox.region,
            instanceType: sandbox.instanceType,
            availabilityZone: sandbox.availabilityZone,
            subnetId: sandbox.subnetId,
            lifecycle: sandbox.lifecycle,
            launchTime: sandbox.launchTime.toISOString(),
            state,
            ...(sandbox.tags[SANDBOX_NAME_TAG_KEY] ? { name: sandbox.tags[SANDBOX_NAME_TAG_KEY] } : {}),
          },
        };
      },

      getUrl: async (sandbox, options) => {
        const resolve = contextForSandbox(sandbox).config.getUrl;
        if (!resolve) {
          throw new Error('aws-ec2 does not support getUrl: instances accept no inbound traffic (commands run over SSM).');
        }
        return resolve(sandbox, options);
      },

      getInstance: (sandbox) => sandbox,
    },
  },
});

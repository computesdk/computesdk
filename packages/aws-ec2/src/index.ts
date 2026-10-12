/**
 * AWS EC2 Spot Provider - Factory-based Implementation
 *
 * Launches one Spot instance per sandbox through an instant EC2 Fleet and runs
 * commands with SSM Run Command (`AWS-RunShellScript`). Nothing listens on the
 * box: the preinstalled SSM agent dials out, so no inbound ports are needed.
 */

import { randomUUID } from 'node:crypto';
import {
  CreateFleetCommand,
  DescribeInstancesCommand,
  EC2Client,
  TerminateInstancesCommand,
  paginateDescribeInstances,
  type CreateFleetError,
  type FleetLaunchTemplateOverridesRequest,
  type Instance as Ec2Instance,
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

export interface AwsEc2Config {
  /** AWS region, e.g. "us-east-2". Falls back to AWS_REGION. */
  region?: string;
  /** Launch template carrying AMI, IMDSv2, root volume, security group, public IP, and instance profile. */
  launchTemplateName: string;
  /** Launch template version (default "$Default"). */
  launchTemplateVersion?: string;
  /** Subnets to launch into, one per AZ. */
  subnetIds: string[];
  /** Instance types the fleet may pick from. */
  instanceTypes: string[];
  /** Max total Spot price per hour, e.g. "0.05". */
  maxPricePerHour?: string;
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
}

export type AwsEc2Lifecycle = 'spot' | 'on-demand';

/** Native sandbox handle exposed via `getInstance()`. */
export interface AwsEc2Sandbox {
  instanceId: string;
  region: string;
  instanceType?: string;
  availabilityZone?: string;
  subnetId?: string;
  lifecycle: AwsEc2Lifecycle;
  launchTime: Date;
  state: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  tags: Record<string, string>;
}

export interface AwsEc2FleetErrorDetail {
  code?: string;
  message?: string;
  instanceType?: string;
  subnetId?: string;
  availabilityZone?: string;
}

/** CreateFleet returned no instance. `errors` holds the per-override AWS errors. */
export class AwsEc2FleetError extends Error {
  readonly errors: AwsEc2FleetErrorDetail[];
  constructor(message: string, errors: AwsEc2FleetErrorDetail[]) {
    super(message);
    this.name = 'AwsEc2FleetError';
    this.errors = errors;
  }
  get codes(): string[] {
    return [...new Set(this.errors.map((error) => error.code).filter((code): code is string => !!code))];
  }
}

/** No Spot capacity (or quota/price headroom) across the configured instance types and subnets. */
export class AwsEc2CapacityError extends AwsEc2FleetError {
  readonly code = 'AWS_EC2_CAPACITY_UNAVAILABLE';
  constructor(message: string, errors: AwsEc2FleetErrorDetail[]) {
    super(message, errors);
    this.name = 'AwsEc2CapacityError';
  }
}

/** The instance launched but never came Online in SSM; it has been terminated. */
export class AwsEc2ReadyTimeoutError extends Error {
  constructor(readonly instanceId: string, readonly timeoutMs: number) {
    super(`EC2 instance ${instanceId} did not come Online in SSM within ${timeoutMs}ms; it was terminated.`);
    this.name = 'AwsEc2ReadyTimeoutError';
  }
}

/** Works across bundle copies where `instanceof` does not. */
export function isAwsEc2CapacityError(error: unknown): error is AwsEc2CapacityError {
  return error instanceof AwsEc2CapacityError || (error instanceof Error && error.name === 'AwsEc2CapacityError');
}

interface Clients {
  ec2: EC2Client;
  ssm: SSMClient;
  s3?: S3Client;
}

interface Context {
  config: AwsEc2Config;
  region: string;
  clients: Clients;
}

const clientCache = new WeakMap<AwsEc2Config, Context>();
/** Keeps clients/credentials off the public `getInstance()` object. */
const sandboxContexts = new WeakMap<AwsEc2Sandbox, Context>();

function resolveRegion(config: AwsEc2Config): string {
  const region = config.region ?? process.env.AWS_REGION;
  if (!region) {
    throw new Error(
      'Missing AWS region for aws-ec2.\n\n' +
      'Pass it: awsEc2({ region: "us-east-2", ... })\n' +
      'Or set AWS_REGION in your environment.'
    );
  }
  return region;
}

function contextFor(config: AwsEc2Config): Context {
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

function contextForSandbox(sandbox: AwsEc2Sandbox): Context {
  const context = sandboxContexts.get(sandbox);
  if (!context) throw new Error(`aws-ec2 client state is unavailable for instance ${sandbox.instanceId}.`);
  return context;
}

function validateLaunchConfig(config: AwsEc2Config): void {
  const missing: string[] = [];
  if (!config.launchTemplateName) missing.push('launchTemplateName');
  if (!config.subnetIds?.length) missing.push('subnetIds');
  if (!config.instanceTypes?.length) missing.push('instanceTypes');
  if (missing.length) {
    throw new Error(
      `Missing aws-ec2 config: ${missing.join(', ')}.\n\n` +
      'Pass them: awsEc2({ region, launchTemplateName, subnetIds: [...], instanceTypes: [...] })'
    );
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { name, Code, code } = error as { name?: string; Code?: string; code?: string };
  return Code ?? code ?? name;
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

export function buildOverrides(config: AwsEc2Config): FleetLaunchTemplateOverridesRequest[] {
  return config.instanceTypes.flatMap((InstanceType) =>
    config.subnetIds.map((SubnetId) => ({ InstanceType: InstanceType as FleetLaunchTemplateOverridesRequest['InstanceType'], SubnetId }))
  );
}

function fleetErrorDetail(error: CreateFleetError): AwsEc2FleetErrorDetail {
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

function sandboxFromEc2(context: Context, instance: Ec2Instance): AwsEc2Sandbox {
  const sandbox: AwsEc2Sandbox = {
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

async function launchInstance(context: Context, options?: CreateInstanceOptions) {
  const { config } = context;
  const tags = buildTags(options);
  const result = await context.clients.ec2.send(new CreateFleetCommand({
    Type: 'instant',
    ClientToken: randomUUID(),
    TargetCapacitySpecification: { TotalTargetCapacity: 1, DefaultTargetCapacityType: 'spot' },
    SpotOptions: {
      AllocationStrategy: 'price-capacity-optimized',
      ...(config.maxPricePerHour ? { MaxTotalPrice: config.maxPricePerHour } : {}),
    },
    LaunchTemplateConfigs: [{
      LaunchTemplateSpecification: {
        LaunchTemplateName: config.launchTemplateName,
        Version: config.launchTemplateVersion ?? DEFAULT_LAUNCH_TEMPLATE_VERSION,
      },
      Overrides: buildOverrides(config),
    }],
    TagSpecifications: [
      { ResourceType: 'instance', Tags: tags },
      { ResourceType: 'volume', Tags: tags },
    ],
  }));

  const launched = result.Instances?.find((entry) => entry.InstanceIds?.length);
  const instanceId = launched?.InstanceIds?.[0];
  if (!launched || !instanceId) {
    const errors = (result.Errors ?? []).map(fleetErrorDetail);
    const codes = [...new Set(errors.map((error) => error.code).filter(Boolean))];
    const summary = codes.length ? codes.join(', ') : 'no error reported';
    if (errors.length === 0 || errors.every((error) => error.code && CAPACITY_ERROR_CODES.has(error.code))) {
      throw new AwsEc2CapacityError(`No EC2 Spot capacity for ${config.launchTemplateName} (${summary}).`, errors);
    }
    throw new AwsEc2FleetError(`EC2 CreateFleet launched no instance (${summary}).`, errors);
  }

  // Instant fleets can return extra instances on retries of the same token; keep only the first.
  const extras = result.Instances?.flatMap((entry) => entry.InstanceIds ?? []).filter((id) => id !== instanceId) ?? [];
  for (const extra of extras) await terminate(context, extra).catch(() => {});

  return instanceId;
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
    if (remaining <= 0) throw new AwsEc2ReadyTimeoutError(instanceId, timeoutMs);
    await sleep(Math.min(interval, remaining));
    interval = Math.min(interval * 1.5, MAX_POLL_INTERVAL_MS);
  }
}

async function createSandbox(config: AwsEc2Config, options?: CreateInstanceOptions) {
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
    await terminate(context, instanceId).catch(() => {});
    throw error;
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The single shell script handed to AWS-RunShellScript. */
export function buildScript(command: string, options?: RunCommandOptions): string {
  const lines: string[] = [];
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

async function runCommand(sandbox: AwsEc2Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const context = contextForSandbox(sandbox);
  const { config, clients } = context;
  const startedAt = Date.now();
  const executionTimeoutS = options?.timeout ? Math.max(1, Math.ceil(options.timeout / 1000)) : undefined;

  const sent = await clients.ssm.send(new SendCommandCommand({
    DocumentName: 'AWS-RunShellScript',
    InstanceIds: [sandbox.instanceId],
    Parameters: {
      commands: [buildScript(command, options)],
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

  let invocation: GetCommandInvocationCommandOutput | undefined;
  while (true) {
    try {
      invocation = await clients.ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: sandbox.instanceId }));
      if (invocation.Status && TERMINAL_STATUSES.has(invocation.Status)) break;
    } catch (error) {
      if (errorName(error) !== 'InvocationDoesNotExist' || Date.now() > registrationDeadline) throw error;
    }
    if (Date.now() > deadline) {
      await clients.ssm.send(new CancelCommandCommand({ CommandId: commandId, InstanceIds: [sandbox.instanceId] })).catch(() => {});
      throw new Error(`SSM command ${commandId} on ${sandbox.instanceId} did not finish before the client deadline; it was cancelled.`);
    }
    await sleep(interval);
    interval = Math.min(interval * 1.5, basePoll);
  }

  let stdout = invocation.StandardOutputContent ?? '';
  let stderr = invocation.StandardErrorContent ?? '';
  if (config.outputS3Bucket) {
    [stdout, stderr] = await Promise.all([
      stdout.length >= SSM_INLINE_OUTPUT_LIMIT
        ? readS3Output(context, outputS3Key(config.outputS3KeyPrefix, commandId, sandbox.instanceId, 'stdout'), stdout)
        : stdout,
      stderr.length >= SSM_INLINE_OUTPUT_LIMIT
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

export const awsEc2 = defineProvider<AwsEc2Sandbox, AwsEc2Config>({
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
        const sandboxes: Array<{ instance: AwsEc2Sandbox; instanceId: string }> = [];
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
          timeout: context.config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
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

      getUrl: async () => {
        throw new Error('aws-ec2 does not support getUrl: instances accept no inbound traffic (commands run over SSM).');
      },

      getInstance: (sandbox) => sandbox,
    },
  },
});

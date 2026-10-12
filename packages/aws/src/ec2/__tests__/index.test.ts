import { mockClient } from 'aws-sdk-client-mock';
import {
  CreateFleetCommand,
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  type Instance,
} from '@aws-sdk/client-ec2';
import {
  CancelCommandCommand,
  DescribeInstanceInformationCommand,
  GetCommandInvocationCommand,
  InvocationDoesNotExist,
  SSMClient,
  SendCommandCommand,
} from '@aws-sdk/client-ssm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { escapeShellArg } from '@computesdk/provider';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Ec2CapacityError,
  Ec2FleetError,
  Ec2ReadyTimeoutError,
  MANAGED_TAG_KEY,
  SANDBOX_NAME_TAG_KEY,
  SSM_INLINE_OUTPUT_LIMIT,
  ec2,
  buildOverrides,
  buildScript,
  buildTags,
  isEc2CapacityError,
  outputS3Key,
  type Ec2Config,
  type Ec2Sandbox,
} from '../index';

const ec2Mock = mockClient(EC2Client);
const ssm = mockClient(SSMClient);
const s3 = mockClient(S3Client);

const INSTANCE_ID = 'i-0123456789abcdef0';
const COMMAND_ID = 'cmd-0001';

function makeConfig(overrides: Partial<Ec2Config> = {}): Ec2Config {
  return {
    region: 'us-east-2',
    launchTemplate: 'computesdk-market-medium',
    subnetIds: ['subnet-a', 'subnet-b'],
    instanceType: ['c5d.large', 'm7a.large', 'c6in.large'],
    spot: { maxPricePerHour: '0.05' },
    pollIntervalMs: 1,
    readyTimeoutMs: 1_000,
    ...overrides,
  };
}

function ec2Instance(overrides: Partial<Instance> = {}): Instance {
  return {
    InstanceId: INSTANCE_ID,
    InstanceType: 'c5d.large',
    InstanceLifecycle: 'spot',
    Placement: { AvailabilityZone: 'us-east-2a' },
    SubnetId: 'subnet-a',
    LaunchTime: new Date('2026-10-12T00:00:00Z'),
    State: { Name: 'running', Code: 16 },
    Tags: [{ Key: MANAGED_TAG_KEY, Value: 'true' }],
    ...overrides,
  };
}

function notFound() {
  return Object.assign(new Error('The instance ID does not exist'), {
    name: 'InvalidInstanceID.NotFound',
    Code: 'InvalidInstanceID.NotFound',
  });
}

function mockLaunch(instance: Instance = ec2Instance()) {
  ec2Mock.on(CreateFleetCommand).resolves({ Instances: [{ InstanceIds: [INSTANCE_ID], Lifecycle: 'spot' }], Errors: [] });
  ssm.on(DescribeInstanceInformationCommand).resolves({
    InstanceInformationList: [{ InstanceId: INSTANCE_ID, PingStatus: 'Online' }],
  });
  ec2Mock.on(RunInstancesCommand).resolves({ Instances: [{ InstanceId: INSTANCE_ID }] });
  ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [instance] }] });
  ec2Mock.on(TerminateInstancesCommand).resolves({});
}

async function launch(config: Ec2Config = makeConfig()) {
  mockLaunch();
  return ec2(config).sandbox.create();
}

function mockCommand(invocation: Record<string, unknown>) {
  ssm.on(SendCommandCommand).resolves({ Command: { CommandId: COMMAND_ID } });
  ssm.on(GetCommandInvocationCommand).resolves(invocation);
}

beforeEach(() => {
  ec2Mock.reset();
  ssm.reset();
  s3.reset();
});

afterEach(() => {
  delete process.env.AWS_REGION;
});

describe('create', () => {
  it('sends an instant spot fleet over every instance type x subnet', async () => {
    mockLaunch();
    const sandbox = await ec2(makeConfig()).sandbox.create({
      name: 'bench-1',
      metadata: { listing: 'lst_42', 'bad key!': 'v@l#', count: 3 as unknown as string },
    });

    expect(sandbox.sandboxId).toBe(INSTANCE_ID);
    const input = ec2Mock.commandCalls(CreateFleetCommand)[0].args[0].input;
    expect(input.Type).toBe('instant');
    expect(input.TargetCapacitySpecification).toEqual({ TotalTargetCapacity: 1, DefaultTargetCapacityType: 'spot' });
    expect(input.SpotOptions).toEqual({ AllocationStrategy: 'price-capacity-optimized', MaxTotalPrice: '0.05' });
    expect(input.ClientToken).toBeTruthy();

    const [ltConfig] = input.LaunchTemplateConfigs!;
    expect(input.LaunchTemplateConfigs).toHaveLength(1);
    expect(ltConfig.LaunchTemplateSpecification).toEqual({ LaunchTemplateName: 'computesdk-market-medium', Version: '$Default' });
    expect(ltConfig.Overrides).toEqual([
      { InstanceType: 'c5d.large', SubnetId: 'subnet-a' },
      { InstanceType: 'c5d.large', SubnetId: 'subnet-b' },
      { InstanceType: 'm7a.large', SubnetId: 'subnet-a' },
      { InstanceType: 'm7a.large', SubnetId: 'subnet-b' },
      { InstanceType: 'c6in.large', SubnetId: 'subnet-a' },
      { InstanceType: 'c6in.large', SubnetId: 'subnet-b' },
    ]);
    for (const override of ltConfig.Overrides!) {
      expect(Object.keys(override).sort()).toEqual(['InstanceType', 'SubnetId']);
    }

    const expectedTags = [
      { Key: MANAGED_TAG_KEY, Value: 'true' },
      { Key: SANDBOX_NAME_TAG_KEY, Value: 'bench-1' },
      { Key: 'listing', Value: 'lst_42' },
      { Key: 'bad key_', Value: 'v@l_' },
    ];
    expect(input.TagSpecifications).toEqual([
      { ResourceType: 'instance', Tags: expectedTags },
      { ResourceType: 'volume', Tags: expectedTags },
    ]);
    // Launch-template-owned settings are never set by the provider.
    for (const key of ['ImageId', 'KeyName', 'SecurityGroupIds', 'IamInstanceProfile', 'UserData']) {
      expect(JSON.stringify(input)).not.toContain(key);
    }
  });

  it('honours launchTemplateVersion and omits MaxTotalPrice when unset', async () => {
    mockLaunch();
    await ec2(makeConfig({ launchTemplateVersion: '7', spot: true })).sandbox.create();
    const input = ec2Mock.commandCalls(CreateFleetCommand)[0].args[0].input;
    expect(input.LaunchTemplateConfigs![0].LaunchTemplateSpecification!.Version).toBe('7');
    expect(input.SpotOptions).toEqual({ AllocationStrategy: 'price-capacity-optimized' });
  });

  it('exposes instance metadata on the native sandbox and getInfo', async () => {
    const sandbox = await launch();
    const native = sandbox.getInstance() as Ec2Sandbox;
    expect(native).toMatchObject({
      instanceId: INSTANCE_ID,
      region: 'us-east-2',
      instanceType: 'c5d.large',
      availabilityZone: 'us-east-2a',
      lifecycle: 'spot',
      state: 'running',
    });
    expect(native).not.toHaveProperty('clients');

    const info = await sandbox.getInfo();
    expect(info).toMatchObject({ id: INSTANCE_ID, provider: 'aws-ec2', status: 'running' });
    expect(info.metadata).toMatchObject({
      instanceType: 'c5d.large',
      availabilityZone: 'us-east-2a',
      lifecycle: 'spot',
      launchTime: '2026-10-12T00:00:00.000Z',
    });
  });

  it('throws Ec2CapacityError with the AWS codes when no capacity is available', async () => {
    ec2Mock.on(CreateFleetCommand).resolves({
      Instances: [],
      Errors: [
        {
          ErrorCode: 'InsufficientInstanceCapacity',
          ErrorMessage: 'no capacity',
          Lifecycle: 'spot',
          LaunchTemplateAndOverrides: { Overrides: { InstanceType: 'c5d.large', SubnetId: 'subnet-a' } },
        },
        { ErrorCode: 'SpotMaxPriceTooLow', ErrorMessage: 'too cheap', Lifecycle: 'spot' },
      ],
    });

    const error = await ec2(makeConfig()).sandbox.create().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Ec2CapacityError);
    expect(isEc2CapacityError(error)).toBe(true);
    const capacity = error as Ec2CapacityError;
    expect(capacity.code).toBe('AWS_EC2_CAPACITY_UNAVAILABLE');
    expect(capacity.codes).toEqual(['InsufficientInstanceCapacity', 'SpotMaxPriceTooLow']);
    expect(capacity.errors[0]).toMatchObject({ instanceType: 'c5d.large', subnetId: 'subnet-a' });
    expect(ssm.commandCalls(DescribeInstanceInformationCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(0);
  });

  it('throws a non-capacity Ec2FleetError for configuration errors', async () => {
    ec2Mock.on(CreateFleetCommand).resolves({
      Instances: [],
      Errors: [{ ErrorCode: 'InvalidLaunchTemplateName.NotFoundException', ErrorMessage: 'missing' }],
    });
    const error = await ec2(makeConfig()).sandbox.create().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Ec2FleetError);
    expect(isEc2CapacityError(error)).toBe(false);
  });

  it('polls SSM until the instance is Online', async () => {
    mockLaunch();
    ssm.on(DescribeInstanceInformationCommand)
      .resolvesOnce({ InstanceInformationList: [] })
      .resolvesOnce({ InstanceInformationList: [{ InstanceId: INSTANCE_ID, PingStatus: 'ConnectionLost' }] })
      .resolves({ InstanceInformationList: [{ InstanceId: INSTANCE_ID, PingStatus: 'Online' }] });

    await ec2(makeConfig()).sandbox.create();
    const calls = ssm.commandCalls(DescribeInstanceInformationCommand);
    expect(calls).toHaveLength(3);
    expect(calls[0].args[0].input.Filters).toEqual([{ Key: 'InstanceIds', Values: [INSTANCE_ID] }]);
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(0);
  });

  it('terminates the instance when it never comes Online', async () => {
    mockLaunch();
    ssm.on(DescribeInstanceInformationCommand).resolves({ InstanceInformationList: [] });

    const error = await ec2(makeConfig({ readyTimeoutMs: 20 })).sandbox.create().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Ec2ReadyTimeoutError);
    const terminations = ec2Mock.commandCalls(TerminateInstancesCommand);
    expect(terminations).toHaveLength(1);
    expect(terminations[0].args[0].input.InstanceIds).toEqual([INSTANCE_ID]);
  });

  it('prefers options.timeout over readyTimeoutMs', async () => {
    mockLaunch();
    ssm.on(DescribeInstanceInformationCommand).resolves({ InstanceInformationList: [] });
    const error = await ec2(makeConfig({ readyTimeoutMs: 60_000 })).sandbox.create({ timeout: 10 }).catch((e: unknown) => e);
    expect((error as Ec2ReadyTimeoutError).timeoutMs).toBe(10);
  });

  it('terminates the instance when the SSM wait fails', async () => {
    mockLaunch();
    ssm.on(DescribeInstanceInformationCommand).rejects(new Error('AccessDenied'));
    await expect(ec2(makeConfig()).sandbox.create()).rejects.toThrow('AccessDenied');
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(1);
  });

  it('validates required config and region', async () => {
    await expect(ec2(makeConfig({ launchTemplate: '' })).sandbox.create()).rejects.toThrow('launchTemplate');
    await expect(ec2(makeConfig({ region: undefined })).sandbox.create()).rejects.toThrow('AWS_REGION');
    process.env.AWS_REGION = 'us-east-2';
    mockLaunch();
    await expect(ec2(makeConfig({ region: undefined })).sandbox.create()).resolves.toBeTruthy();
  });
});

describe('create (on-demand)', () => {
  const onDemand = (overrides: Partial<Ec2Config> = {}) =>
    makeConfig({ spot: undefined, subnetIds: undefined, instanceType: undefined, ...overrides });

  it('uses RunInstances with only a launch template', async () => {
    mockLaunch(ec2Instance({ InstanceLifecycle: undefined }));
    const sandbox = await ec2(onDemand()).sandbox.create({ name: 'od-1' });

    expect(ec2Mock.commandCalls(CreateFleetCommand)).toHaveLength(0);
    const input = ec2Mock.commandCalls(RunInstancesCommand)[0].args[0].input;
    expect(input).toMatchObject({
      MinCount: 1,
      MaxCount: 1,
      LaunchTemplate: { LaunchTemplateName: 'computesdk-market-medium', Version: '$Default' },
    });
    expect(input).not.toHaveProperty('InstanceType');
    expect(input).not.toHaveProperty('SubnetId');
    expect(input).not.toHaveProperty('InstanceMarketOptions');
    expect(input.TagSpecifications!.map((spec) => spec.ResourceType)).toEqual(['instance', 'volume']);
    expect(input.TagSpecifications![0].Tags).toContainEqual({ Key: MANAGED_TAG_KEY, Value: 'true' });
    expect((sandbox.getInstance() as Ec2Sandbox).lifecycle).toBe('on-demand');
  });

  it('passes a single instanceType and a launch template id', async () => {
    mockLaunch();
    await ec2(onDemand({ launchTemplate: 'lt-0abc123', instanceType: 'm7a.large' })).sandbox.create();
    const input = ec2Mock.commandCalls(RunInstancesCommand)[0].args[0].input;
    expect(input.InstanceType).toBe('m7a.large');
    expect(input.LaunchTemplate).toEqual({ LaunchTemplateId: 'lt-0abc123', Version: '$Default' });
  });

  it('maps RunInstances capacity errors to Ec2CapacityError', async () => {
    mockLaunch();
    ec2Mock.on(RunInstancesCommand).rejects(Object.assign(new Error('no room'), { name: 'InsufficientInstanceCapacity' }));
    const error = await ec2(onDemand({ instanceType: 'm7a.large' })).sandbox.create().catch((e: unknown) => e);
    expect(isEc2CapacityError(error)).toBe(true);
    expect((error as Ec2CapacityError).codes).toEqual(['InsufficientInstanceCapacity']);
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(0);
  });

  it('rethrows other RunInstances errors', async () => {
    mockLaunch();
    ec2Mock.on(RunInstancesCommand).rejects(Object.assign(new Error('bad'), { name: 'UnauthorizedOperation' }));
    await expect(ec2(onDemand()).sandbox.create()).rejects.toThrow('bad');
  });

  it('falls back across several types with an on-demand fleet', async () => {
    mockLaunch();
    await ec2(onDemand({ instanceType: ['m7a.large', 'm5a.large'] })).sandbox.create();
    expect(ec2Mock.commandCalls(RunInstancesCommand)).toHaveLength(0);
    const input = ec2Mock.commandCalls(CreateFleetCommand)[0].args[0].input;
    expect(input.TargetCapacitySpecification).toEqual({ TotalTargetCapacity: 1, DefaultTargetCapacityType: 'on-demand' });
    expect(input).not.toHaveProperty('SpotOptions');
    expect(input.LaunchTemplateConfigs![0].Overrides).toEqual([{ InstanceType: 'm7a.large' }, { InstanceType: 'm5a.large' }]);
  });

  it('uses a fleet when subnets are given', async () => {
    mockLaunch();
    await ec2(onDemand({ subnetIds: ['subnet-a'] })).sandbox.create();
    expect(ec2Mock.commandCalls(CreateFleetCommand)[0].args[0].input.LaunchTemplateConfigs![0].Overrides).toEqual([{ SubnetId: 'subnet-a' }]);
  });
});

describe('runCommand', () => {
  it('sends one AWS-RunShellScript script with escaped env, cwd and timeout', async () => {
    const sandbox = await launch();
    mockCommand({ Status: 'Success', ResponseCode: 0, StandardOutputContent: 'hi\n', StandardErrorContent: '' });

    const env = { FOO: 'a "quoted" $HOME `x` \\ value' };
    const result = await sandbox.runCommand('echo hi', { env, cwd: '/tmp/my dir', timeout: 4_500 });

    expect(result).toMatchObject({ stdout: 'hi\n', stderr: '', exitCode: 0 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const input = ssm.commandCalls(SendCommandCommand)[0].args[0].input;
    expect(input.DocumentName).toBe('AWS-RunShellScript');
    expect(input.InstanceIds).toEqual([INSTANCE_ID]);
    expect(input.Parameters!.executionTimeout).toEqual(['5']);
    expect(input.Parameters!.commands).toEqual([
      `export FOO="${escapeShellArg(env.FOO)}"\ncd "/tmp/my dir" || exit 1\necho hi`,
    ]);
    expect(input.Parameters!.commands![0]).toContain('a \\"quoted\\" \\$HOME \\`x\\` \\\\ value');
    expect(input).not.toHaveProperty('OutputS3BucketName');
  });

  it('rejects invalid environment variable names', () => {
    expect(() => buildScript('true', { env: { 'BAD;rm -rf /': 'x' } })).toThrow('Invalid environment variable name');
  });

  it('detaches background commands', () => {
    expect(buildScript(`echo 'x' > /tmp/o`, { background: true })).toBe(
      `nohup /bin/sh -c 'echo '\\''x'\\'' > /tmp/o' >/dev/null 2>&1 &`
    );
  });

  it.each([
    [{ Status: 'Success', ResponseCode: 0 }, 0],
    [{ Status: 'Failed', ResponseCode: 2 }, 2],
    [{ Status: 'Failed', ResponseCode: -1 }, 1],
    [{ Status: 'TimedOut', ResponseCode: -1 }, 124],
    [{ Status: 'Cancelled', ResponseCode: -1 }, 130],
  ])('maps %o to exit code %i', async (invocation, exitCode) => {
    const sandbox = await launch();
    mockCommand({ ...invocation, StandardOutputContent: '', StandardErrorContent: '' });
    const result = await sandbox.runCommand('false', { timeout: 1_000 });
    expect(result.exitCode).toBe(exitCode);
  });

  it('polls through in-progress statuses until terminal', async () => {
    const sandbox = await launch();
    ssm.on(SendCommandCommand).resolves({ Command: { CommandId: COMMAND_ID } });
    ssm.on(GetCommandInvocationCommand)
      .resolvesOnce({ Status: 'Pending' })
      .resolvesOnce({ Status: 'InProgress' })
      .resolves({ Status: 'Success', ResponseCode: 0, StandardOutputContent: 'done' });

    const result = await sandbox.runCommand('sleep 1');
    expect(result.stdout).toBe('done');
    expect(ssm.commandCalls(GetCommandInvocationCommand)).toHaveLength(3);
    expect(ssm.commandCalls(GetCommandInvocationCommand)[0].args[0].input).toEqual({ CommandId: COMMAND_ID, InstanceId: INSTANCE_ID });
  });

  it('retries InvocationDoesNotExist right after SendCommand', async () => {
    const sandbox = await launch();
    ssm.on(SendCommandCommand).resolves({ Command: { CommandId: COMMAND_ID } });
    ssm.on(GetCommandInvocationCommand)
      .rejectsOnce(new InvocationDoesNotExist({ message: 'not yet', $metadata: {} }))
      .rejectsOnce(new InvocationDoesNotExist({ message: 'not yet', $metadata: {} }))
      .resolves({ Status: 'Success', ResponseCode: 0, StandardOutputContent: 'ok' });

    const result = await sandbox.runCommand('echo ok');
    expect(result).toMatchObject({ stdout: 'ok', exitCode: 0 });
    expect(ssm.commandCalls(GetCommandInvocationCommand)).toHaveLength(3);
  });

  it('propagates other GetCommandInvocation errors', async () => {
    const sandbox = await launch();
    ssm.on(SendCommandCommand).resolves({ Command: { CommandId: COMMAND_ID } });
    ssm.on(GetCommandInvocationCommand).rejects(new Error('ThrottlingException'));
    await expect(sandbox.runCommand('echo')).rejects.toThrow('ThrottlingException');
  });

  it('returns truncated inline output when no S3 bucket is configured', async () => {
    const sandbox = await launch();
    const truncated = 'x'.repeat(SSM_INLINE_OUTPUT_LIMIT);
    mockCommand({ Status: 'Success', ResponseCode: 0, StandardOutputContent: truncated });
    const result = await sandbox.runCommand('yes | head -c 100000');
    expect(result.stdout).toHaveLength(SSM_INLINE_OUTPUT_LIMIT);
    expect(s3.calls()).toHaveLength(0);
  });

  it('reads full output from S3 when the inline output is truncated', async () => {
    const config = makeConfig({ outputS3Bucket: 'csdk-output', outputS3KeyPrefix: 'runs/' });
    const sandbox = await launch(config);
    const truncated = 'x'.repeat(SSM_INLINE_OUTPUT_LIMIT);
    mockCommand({ Status: 'Success', ResponseCode: 0, StandardOutputContent: truncated, StandardErrorContent: 'warn' });
    const full = 'x'.repeat(SSM_INLINE_OUTPUT_LIMIT * 3);
    s3.on(GetObjectCommand).resolves({ Body: { transformToString: async () => full } as never });

    const result = await sandbox.runCommand('yes | head -c 72000');

    const input = ssm.commandCalls(SendCommandCommand)[0].args[0].input;
    expect(input.OutputS3BucketName).toBe('csdk-output');
    expect(input.OutputS3KeyPrefix).toBe('runs/');
    expect(result.stdout).toBe(full);
    expect(result.stderr).toBe('warn');
    const gets = s3.commandCalls(GetObjectCommand);
    expect(gets).toHaveLength(1);
    expect(gets[0].args[0].input).toEqual({
      Bucket: 'csdk-output',
      Key: `runs/${COMMAND_ID}/${INSTANCE_ID}/awsrunShellScript/0.awsrunShellScript/stdout`,
    });
  });

  it('falls back to inline output when the S3 object is missing', async () => {
    const sandbox = await launch(makeConfig({ outputS3Bucket: 'csdk-output' }));
    const truncated = 'y'.repeat(SSM_INLINE_OUTPUT_LIMIT);
    mockCommand({ Status: 'Success', ResponseCode: 0, StandardOutputContent: truncated });
    s3.on(GetObjectCommand).rejects(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    expect((await sandbox.runCommand('x')).stdout).toBe(truncated);
  });

  it('builds S3 keys with and without a prefix', () => {
    expect(outputS3Key(undefined, 'c', 'i', 'stderr')).toBe('c/i/awsrunShellScript/0.awsrunShellScript/stderr');
    expect(outputS3Key('a/b', 'c', 'i', 'stdout')).toBe('a/b/c/i/awsrunShellScript/0.awsrunShellScript/stdout');
  });

  it('cancels and throws when the command outlives the client deadline', async () => {
    const sandbox = await launch();
    ssm.on(SendCommandCommand).resolves({ Command: { CommandId: COMMAND_ID } });
    ssm.on(GetCommandInvocationCommand).resolves({ Status: 'InProgress' });
    ssm.on(CancelCommandCommand).resolves({});
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    try {
      const pending = sandbox.runCommand('sleep 999', { timeout: 1_000 });
      offset = 10 * 60_000;
      await expect(pending).rejects.toThrow('cancelled');
    } finally {
      Date.now = realNow;
    }
    expect(ssm.commandCalls(CancelCommandCommand)).toHaveLength(1);
  });
});

describe('getById', () => {
  it('returns a managed running instance', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [ec2Instance()] }] });
    const sandbox = await ec2(makeConfig()).sandbox.getById(INSTANCE_ID);
    expect(sandbox?.sandboxId).toBe(INSTANCE_ID);
  });

  it.each([
    ['untagged', ec2Instance({ Tags: [] })],
    ['managed=false', ec2Instance({ Tags: [{ Key: MANAGED_TAG_KEY, Value: 'false' }] })],
    ['terminated', ec2Instance({ State: { Name: 'terminated' } })],
    ['shutting-down', ec2Instance({ State: { Name: 'shutting-down' } })],
  ])('returns null for %s instances', async (_label, instance) => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [instance] }] });
    expect(await ec2(makeConfig()).sandbox.getById(INSTANCE_ID)).toBeNull();
  });

  it('returns null when the instance does not exist', async () => {
    ec2Mock.on(DescribeInstancesCommand).rejects(notFound());
    expect(await ec2(makeConfig()).sandbox.getById(INSTANCE_ID)).toBeNull();
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [] });
    expect(await ec2(makeConfig()).sandbox.getById(INSTANCE_ID)).toBeNull();
  });
});

describe('list', () => {
  it('filters on the managed tag and live states', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [ec2Instance(), ec2Instance({ InstanceId: 'i-second' })] }],
    });
    const sandboxes = await ec2(makeConfig()).sandbox.list();
    expect(sandboxes.map((sandbox) => sandbox.sandboxId)).toEqual([INSTANCE_ID, 'i-second']);
    expect(ec2Mock.commandCalls(DescribeInstancesCommand)[0].args[0].input.Filters).toEqual([
      { Name: `tag:${MANAGED_TAG_KEY}`, Values: ['true'] },
      { Name: 'instance-state-name', Values: ['pending', 'running'] },
    ]);
  });
});

describe('destroy', () => {
  it('terminates a managed instance', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [ec2Instance()] }] });
    ec2Mock.on(TerminateInstancesCommand).resolves({});
    await ec2(makeConfig()).sandbox.destroy(INSTANCE_ID);
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)[0].args[0].input).toEqual({ InstanceIds: [INSTANCE_ID] });
  });

  it('is a no-op for missing or terminated instances', async () => {
    ec2Mock.on(DescribeInstancesCommand).rejects(notFound());
    await expect(ec2(makeConfig()).sandbox.destroy(INSTANCE_ID)).resolves.toBeUndefined();
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [ec2Instance({ State: { Name: 'terminated' } })] }] });
    await expect(ec2(makeConfig()).sandbox.destroy(INSTANCE_ID)).resolves.toBeUndefined();
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(0);
  });

  it('treats a NotFound race on TerminateInstances as success', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [ec2Instance()] }] });
    ec2Mock.on(TerminateInstancesCommand).rejects(notFound());
    await expect(ec2(makeConfig()).sandbox.destroy(INSTANCE_ID)).resolves.toBeUndefined();
  });

  it('refuses to terminate instances it does not manage', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [ec2Instance({ Tags: [] })] }] });
    await expect(ec2(makeConfig()).sandbox.destroy(INSTANCE_ID)).rejects.toThrow('Refusing to terminate');
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('builds the instance type x subnet product', () => {
    expect(buildOverrides(makeConfig({ instanceType: ['a', 'b'], subnetIds: ['s1', 's2', 's3'] }))).toHaveLength(6);
    expect(buildOverrides(makeConfig({ instanceType: undefined, subnetIds: ['s1', 's2'] }))).toEqual([{ SubnetId: 's1' }, { SubnetId: 's2' }]);
    expect(buildOverrides(makeConfig({ instanceType: 'a', subnetIds: undefined }))).toEqual([{ InstanceType: 'a' }]);
    expect(buildOverrides(makeConfig({ instanceType: undefined, subnetIds: undefined }))).toEqual([]);
  });

  it('sanitizes and caps tags, keeping the managed tag', () => {
    const metadata: Record<string, string> = { 'aws:reserved': 'x', [MANAGED_TAG_KEY]: 'false' };
    for (let i = 0; i < 80; i++) metadata[`k${i}`] = 'v'.repeat(300);
    const tags = buildTags({ metadata });
    expect(tags).toHaveLength(50);
    expect(tags[0]).toEqual({ Key: MANAGED_TAG_KEY, Value: 'true' });
    expect(tags.some((tag) => tag.Key === 'aws:reserved')).toBe(false);
    expect(tags.every((tag) => tag.Value!.length <= 256)).toBe(true);
  });

  it('getUrl is unsupported', async () => {
    const sandbox = await launch();
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow('does not support getUrl');
  });
});

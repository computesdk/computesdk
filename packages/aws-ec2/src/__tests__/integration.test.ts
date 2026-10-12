import { runProviderTestSuite } from '@computesdk/test-utils';
import { describe, expect, it } from 'vitest';
import { awsEc2, type AwsEc2Config, type AwsEc2Sandbox } from '../index';

const list = (value: string | undefined) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const config: AwsEc2Config = {
  region: process.env.AWS_REGION ?? 'us-east-2',
  launchTemplateName: process.env.AWS_EC2_LAUNCH_TEMPLATE ?? '',
  launchTemplateVersion: process.env.AWS_EC2_LAUNCH_TEMPLATE_VERSION,
  subnetIds: list(process.env.AWS_EC2_SUBNET_IDS),
  instanceTypes: list(process.env.AWS_EC2_INSTANCE_TYPES),
  maxPricePerHour: process.env.AWS_EC2_MAX_PRICE_PER_HOUR,
  readyTimeoutMs: 180_000,
  outputS3Bucket: process.env.AWS_EC2_OUTPUT_S3_BUCKET,
  outputS3KeyPrefix: process.env.AWS_EC2_OUTPUT_S3_KEY_PREFIX,
};

const enabled =
  process.env.AWS_EC2_INTEGRATION === '1' &&
  !!config.launchTemplateName &&
  config.subnetIds.length > 0 &&
  config.instanceTypes.length > 0;

runProviderTestSuite({
  name: 'aws-ec2',
  provider: awsEc2(config),
  supportsFilesystem: false,
  supportsGetUrl: false,
  skipIntegration: !enabled,
  timeout: 300_000,
});

describe.runIf(enabled)('aws-ec2 spot lifecycle', () => {
  it('launches a managed spot instance, runs commands over SSM, and terminates it', async () => {
    const provider = awsEc2(config);
    const sandbox = await provider.sandbox.create({ name: `csdk-it-${Date.now()}` });
    try {
      const native = sandbox.getInstance() as AwsEc2Sandbox;
      expect(native.tags['computesdk:managed']).toBe('true');
      expect(config.instanceTypes).toContain(native.instanceType);

      const result = await sandbox.runCommand('echo "$GREETING from $(pwd) as $(whoami)"', {
        env: { GREETING: 'hello "world"' },
        cwd: '/tmp',
        timeout: 30_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello "world" from /tmp as root');

      expect((await sandbox.runCommand('exit 3')).exitCode).toBe(3);

      const found = await provider.sandbox.getById(sandbox.sandboxId);
      expect(found?.sandboxId).toBe(sandbox.sandboxId);
      expect((await provider.sandbox.list()).map((entry) => entry.sandboxId)).toContain(sandbox.sandboxId);
    } finally {
      await provider.sandbox.destroy(sandbox.sandboxId);
    }
    expect(await provider.sandbox.getById(sandbox.sandboxId)).toBeNull();
    await expect(provider.sandbox.destroy(sandbox.sandboxId)).resolves.toBeUndefined();
  }, 600_000);
});

import { runProviderTestSuite } from '@computesdk/test-utils';
import { describe, expect, it } from 'vitest';
import { awsEc2, instanceTypesOf, type AwsEc2Config, type AwsEc2Sandbox } from '../index';

/**
 * Set AWS_EC2_INTEGRATION_CONFIG to a JSON AwsEc2Config to run against real AWS, e.g.
 * '{"launchTemplate":"my-template","region":"us-east-2","instanceType":"m7a.large"}'
 */
const raw = process.env.AWS_EC2_INTEGRATION_CONFIG;
const config: AwsEc2Config = { readyTimeoutMs: 180_000, ...(raw ? JSON.parse(raw) : { launchTemplate: '' }) };
const enabled = !!raw && !!config.launchTemplate;

runProviderTestSuite({
  name: 'aws-ec2',
  provider: awsEc2(config),
  supportsFilesystem: false,
  supportsGetUrl: false,
  skipIntegration: !enabled,
  timeout: 300_000,
});

describe.runIf(enabled)('aws-ec2 lifecycle', () => {
  it('launches a managed instance, runs commands over SSM, and terminates it', async () => {
    const provider = awsEc2(config);
    const sandbox = await provider.sandbox.create({ name: `csdk-it-${Date.now()}` });
    try {
      const native = sandbox.getInstance() as AwsEc2Sandbox;
      expect(native.tags['computesdk:managed']).toBe('true');
      expect(native.lifecycle).toBe(config.spot ? 'spot' : 'on-demand');
      const menu = instanceTypesOf(config);
      if (menu.length) expect(menu).toContain(native.instanceType);

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

import { describe, expect, it } from 'vitest';
import { tangle } from '../index';

const runLive =
  (process.env.RUN_INTEGRATION === '1' || process.env.RUN_INTEGRATION === 'true') &&
  Boolean(process.env.TANGLE_API_KEY);

describe.skipIf(!runLive)('Tangle native lifecycle integration', () => {
  it('creates, executes, looks up and confirms destruction of an owned instance', async () => {
    const provider = tangle();
    const instance = await provider.instances.create();
    try {
      const result = await instance.runCommand('printf "%s" "$COMPUTESDK_TANGLE_CHECK"', {
        env: { COMPUTESDK_TANGLE_CHECK: 'native-command' },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('native-command');
      expect((await instance.getInfo()).status).toBe('running');
      expect((await provider.instances.getById(instance.instanceId))?.instanceId).toBe(instance.instanceId);
      expect((await provider.instances.list()).some((entry) => entry.instanceId === instance.instanceId)).toBe(true);
    } finally {
      // Cleanup failure fails this test; it must never be converted to a passing result.
      await instance.destroy();
    }
    expect(await provider.instances.getById(instance.instanceId)).toBeNull();
  }, 180_000);
});

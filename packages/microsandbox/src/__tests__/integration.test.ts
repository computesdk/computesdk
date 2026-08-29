import { randomUUID } from 'node:crypto';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { describe, expect, it } from 'vitest';
import { microsandbox } from '../index.js';

runProviderTestSuite({
  name: 'microsandbox',
  provider: microsandbox({ backend: 'local', ports: [3000, 8080] }),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsGetUrl: true,
  ports: [3000, 8080],
  skipIntegration: process.env.MSB_RUN_INTEGRATION !== '1',
  timeout: 120_000,
});

describe.runIf(process.env.MSB_RUN_INTEGRATION === '1')('microsandbox local snapshots', () => {
  it('restores filesystem state through the ComputeSDK snapshot API', async () => {
    const provider = microsandbox({ backend: 'local' });
    const suffix = randomUUID().slice(0, 8);
    const original = await provider.sandbox.create({ name: `csdk-snapshot-source-${suffix}` });
    let restored: Awaited<ReturnType<typeof provider.sandbox.create>> | undefined;
    let snapshotId: string | undefined;

    try {
      // /tmp is a guest tmpfs and intentionally is not part of disk snapshots.
      await original.filesystem.writeFile('/from-snapshot.txt', 'persisted');
      const snapshot = await provider.snapshot!.create(original.sandboxId, {
        name: `csdk-snapshot-${suffix}`,
      });
      snapshotId = snapshot.id;
      restored = await provider.sandbox.create({
        name: `csdk-snapshot-restored-${suffix}`,
        snapshotId,
      });

      expect(await restored.filesystem.readFile('/from-snapshot.txt')).toBe('persisted');
    } finally {
      if (restored) await restored.destroy();
      await original.destroy();
      if (snapshotId) await provider.snapshot!.delete(snapshotId);
    }
  }, 120_000);
});

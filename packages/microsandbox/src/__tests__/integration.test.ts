import { randomUUID } from 'node:crypto';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { describe, expect, it } from 'vitest';
import { microsandbox } from '../index.js';

const runIntegration = process.env.MSB_RUN_INTEGRATION === '1';
// Cloud when credentials are present (CI); MSB_BACKEND=local forces the
// runtime on this machine, which needs KVM.
const backend = process.env.MSB_BACKEND === 'local' || !process.env.MSB_API_KEY ? 'local' : 'cloud';
const local = backend === 'local';

runProviderTestSuite({
  name: 'microsandbox',
  provider: local ? microsandbox({ backend, ports: [3000, 8080] }) : microsandbox({ backend }),
  supportsFilesystem: true,
  supportsStreaming: true,
  // Published ports are a local-backend feature.
  supportsGetUrl: local,
  ...(local ? { ports: [3000, 8080] } : {}),
  supportsSnapshots: true,
  // Pause/resume is local-only: the cloud backend rejects it as unsupported.
  skipIntegration: !runIntegration,
  timeout: 120_000,
});

describe.runIf(runIntegration && local)('microsandbox local snapshots', () => {
  it('restores filesystem state through the ComputeSDK snapshot API', async () => {
    const provider = microsandbox({ backend: 'local' });
    const suffix = randomUUID().slice(0, 8);
    const original = await provider.sandbox.create({ name: `csdk-snapshot-source-${suffix}`, ephemeral: false });
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

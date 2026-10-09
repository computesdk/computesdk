import { describe, expect, it } from 'vitest';
import { neevcloud } from '../index';

// Live round trip: a file written before a snapshot is present in a sandbox restored from it.
describe.skipIf(!process.env.NEEV_API_KEY)('neevcloud snapshots (live)', () => {
  it('restores a snapshot into a new sandbox through create({ snapshotId })', async () => {
    const provider = neevcloud({});
    const source = await provider.sandbox.create();
    let restoredId: string | undefined;
    let snapshotId: string | undefined;
    try {
      await source.filesystem.writeFile('marker.txt', 'from-snapshot');
      const snapshot = await provider.snapshot!.create(source.sandboxId, { name: 'computesdk-test' });
      snapshotId = snapshot.id;
      expect(snapshot.metadata.status).toBe('Ready');

      const listed = await provider.snapshot!.list({ sandboxId: source.sandboxId });
      expect(listed.map((s) => s.id)).toContain(snapshot.id);

      const restored = await provider.sandbox.create({ snapshotId: snapshot.id });
      restoredId = restored.sandboxId;
      expect(await restored.filesystem.readFile('marker.txt')).toBe('from-snapshot');
    } finally {
      if (restoredId) await provider.sandbox.destroy(restoredId).catch(() => undefined);
      if (snapshotId) await provider.snapshot!.delete(snapshotId).catch(() => undefined);
      await source.destroy().catch(() => undefined);
    }
  }, 300_000);
});

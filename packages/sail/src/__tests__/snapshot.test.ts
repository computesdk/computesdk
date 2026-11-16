import { describe, expect, it } from 'vitest';
import { sail } from '../index';

const live = Boolean(process.env.SAIL_API_KEY);

describe.skipIf(!live)('sail checkpoints (live)', () => {
  it('checkpoints a Sailbox, restores it into a new one, then lists and deletes the checkpoint', async () => {
    const compute = sail({ apiKey: process.env.SAIL_API_KEY, app: process.env.SAIL_APP });
    const marker = `marker-${Date.now()}`;
    const source = await compute.sandbox.create();
    let restored: Awaited<ReturnType<typeof compute.sandbox.create>> | undefined;
    let snapshotId: string | undefined;
    try {
      await source.filesystem.writeFile('/tmp/marker.txt', marker);
      const snapshot = await compute.snapshot!.create(source.sandboxId, { name: 'csdk-live' });
      const id = snapshot.id;
      snapshotId = id;
      expect(snapshot.id).not.toBe(source.sandboxId);

      await source.destroy();
      restored = await compute.sandbox.create({ snapshotId: id });
      expect(restored.sandboxId).not.toBe(source.sandboxId);
      expect(await restored.filesystem.readFile('/tmp/marker.txt')).toBe(marker);

      const listed = await compute.snapshot!.list({ instanceId: source.sandboxId });
      expect(listed.map((s) => s.id)).toContain(id);

      await compute.snapshot!.delete(id);
      const after = await compute.snapshot!.list({ instanceId: source.sandboxId });
      expect(after.map((s) => s.id)).not.toContain(id);
      await compute.snapshot!.delete(id);
      snapshotId = undefined;
    } finally {
      await restored?.destroy().catch(() => undefined);
      await source.destroy().catch(() => undefined);
      if (snapshotId) await compute.snapshot!.delete(snapshotId).catch(() => undefined);
    }
  }, 300_000);
});

import { afterAll, describe, expect, it } from 'vitest';
import { namespace } from '../index';

// Live: volume snapshot round trip — write, snapshot (destroys the source),
// restore twice concurrently (fanout), read back, delete.
describe.skipIf(!process.env.NSC_TOKEN)('namespace snapshot (live)', () => {
  const provider = namespace({});
  const sandboxes: Array<{ destroy(): Promise<void> }> = [];
  const snapshots: string[] = [];

  afterAll(async () => {
    await Promise.all(sandboxes.map((s) => s.destroy().catch(() => {})));
    await Promise.all(snapshots.map((id) => provider.snapshot!.delete(id).catch(() => {})));
  });

  it('restores volume contents from snapshot.create', async () => {
    const source = await provider.sandbox.create({ snapshotVolume: true } as any);
    sandboxes.push(source);
    const workdir = (await source.runCommand('pwd')).stdout.trim();
    expect(workdir).toBe('/workspace');
    await source.filesystem.mkdir(`${workdir}/live`);
    await source.filesystem.writeFile(`${workdir}/live/marker.txt`, 'namespace-snapshot-ok');
    await source.runCommand('echo rootfs > /tmp/rootfs-marker && sync');

    const snapshot = await provider.snapshot!.create(source.sandboxId);
    snapshots.push(snapshot.id);
    expect(snapshot.id).not.toBe(source.sandboxId);
    expect(snapshot.id).toMatch(/^computesdk-[^/]+\/[^/]+$/);
    expect(await provider.sandbox.getById(source.sandboxId)).toBeNull();

    const listed = await provider.snapshot!.list({ sandboxId: source.sandboxId });
    expect(listed.map((s: any) => s.id)).toContain(snapshot.id);

    const clones = await Promise.all([0, 1].map(() => provider.sandbox.create({ snapshotId: snapshot.id } as any)));
    sandboxes.push(...clones);
    for (const clone of clones) {
      expect((await clone.runCommand('pwd')).stdout.trim()).toBe('/workspace');
      expect(await clone.filesystem.readFile('/workspace/live/marker.txt')).toBe('namespace-snapshot-ok');
      // Volume-only: the rootfs is not part of the snapshot.
      expect(await clone.filesystem.exists('/tmp/rootfs-marker')).toBe(false);
    }

    // Clones are independent copies.
    await clones[0].filesystem.writeFile('/workspace/live/clone.txt', 'zero');
    expect(await clones[1].filesystem.exists('/workspace/live/clone.txt')).toBe(false);

    // The snapshot stays restorable after earlier restores.
    const later = await provider.sandbox.create({ snapshotId: snapshot.id } as any);
    sandboxes.push(later);
    expect(await later.filesystem.readFile('/workspace/live/marker.txt')).toBe('namespace-snapshot-ok');
    expect(await later.filesystem.exists('/workspace/live/clone.txt')).toBe(false);

    await provider.snapshot!.delete(snapshot.id);
    expect((await provider.snapshot!.list()).map((s: any) => s.id)).not.toContain(snapshot.id);
  }, 10 * 60_000);
});

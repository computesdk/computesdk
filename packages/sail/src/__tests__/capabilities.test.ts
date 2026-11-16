import { describe, expect, it } from 'vitest';
import { sail } from '../index';

const live = Boolean(process.env.SAIL_API_KEY);

describe.skipIf(!live)('sail images and volumes (live)', () => {
  it('boots an OCI image, passes environment and lifetime, and preserves a volume across boxes', async () => {
    const compute = sail({ apiKey: process.env.SAIL_API_KEY, app: process.env.SAIL_APP });
    const volume = await compute.volume!.create({ name: `csdk-test-${crypto.randomUUID()}` });
    const boxes: Awaited<ReturnType<typeof compute.instances.create>>[] = [];
    try {
      const writer = await compute.instances.create({
        image: 'node:22', envs: { CSDK_MARKER: 'persisted' }, timeout: 600_000,
        volumes: [{ volume, mountPath: '/csdk-data' }],
      });
      boxes.push(writer);
      expect((await writer.runCommand('node --version')).stdout).toMatch(/^v22\./);
      expect((await writer.runCommand('printenv CSDK_MARKER')).stdout.trim()).toBe('persisted');
      const remaining = (await writer.getInfo()).timeout;
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(600_000);
      await writer.filesystem.writeFile('/csdk-data/marker.txt', 'persisted');
      await writer.destroy();
      boxes.pop();

      const reader = await compute.instances.create({
        volumes: [{ volume: volume.id!, mountPath: '/csdk-data', readOnly: true }],
        timeout: 600_000,
      });
      boxes.push(reader);
      expect(await reader.filesystem.readFile('/csdk-data/marker.txt')).toBe('persisted');
      expect((await reader.runCommand('touch /csdk-data/forbidden')).exitCode).not.toBe(0);
      expect(await compute.volume!.get(volume.id!)).toMatchObject({ id: volume.id });
    } finally {
      const cleanup = await Promise.allSettled(boxes.map((box) => box.destroy()));
      await compute.volume!.delete(volume.id!);
      const failure = cleanup.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
  }, 600_000);
});

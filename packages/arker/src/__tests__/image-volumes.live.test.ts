import { describe, expect, it } from 'vitest';
import { arker } from '../index';

const live = !!process.env.ARKER_API_KEY;
const MOUNT = '/mnt/live-volume';

describe.skipIf(!live)('Arker OCI image and volumes (live)', () => {
  const provider = arker({});

  // Not ubuntu:24.04, which the default golden also reports: this one can only come from the image.
  it('boots an OCI image', async () => {
    const sandbox = await provider.instances.create({ image: 'python:3.12-slim' });
    try {
      expect((await sandbox.runCommand('. /etc/os-release && echo $ID')).stdout.trim()).toBe('debian');
      expect((await sandbox.runCommand('python3 --version')).stdout).toMatch(/^Python 3\.12\./);
    } finally {
      await sandbox.destroy();
    }
  }, 180_000);

  it('keeps a volume across sandboxes, and detaches and reattaches it', async () => {
    const volume = await provider.volume!.create({ name: `live-${Date.now().toString(36)}` });
    const sandboxes: { destroy(): Promise<void> }[] = [];
    try {
      const first = await provider.instances.create({ volumes: [{ volume, mountPath: MOUNT }] });
      sandboxes.push(first);
      expect((await first.runCommand(`echo -n kept > ${MOUNT}/marker && cat ${MOUNT}/marker`)).stdout).toBe('kept');
      await first.destroy();

      const second = await provider.instances.create({ volumes: [{ volume: volume.name!, mountPath: MOUNT }] });
      sandboxes.push(second);
      expect((await second.runCommand(`cat ${MOUNT}/marker`)).stdout).toBe('kept');

      await second.detachVolume!(volume, MOUNT);
      expect((await second.runCommand(`grep -c ' ${MOUNT} ' /proc/mounts`)).stdout.trim()).toBe('0');
      await second.attachVolume!(volume, MOUNT);
      expect((await second.runCommand(`cat ${MOUNT}/marker`)).stdout).toBe('kept');

      expect(await provider.volume!.get(volume.name!)).toMatchObject({ id: volume.id });
      expect(await provider.volume!.get(volume.id!)).toMatchObject({ name: volume.name });
    } finally {
      for (const s of sandboxes) await s.destroy().catch(() => {});
      await provider.volume!.delete(volume.id!);
    }
    expect(await provider.volume!.get(volume.id!)).toBeNull();
  }, 300_000);
});

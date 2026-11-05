// Import from test-utils to trigger .env loading from monorepo root
import '@computesdk/test-utils';

import { describe, it, expect } from 'vitest';
import { modal } from '../index';

const skip = !process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET;

describe('Modal live runtime', () => {
  it.skipIf(skip)('default image ships Node >= 22.5 (node:sqlite)', async () => {
    const provider = modal({});
    const sandbox = await provider.sandbox.create();
    try {
      const r = await sandbox.runCommand(`node -e "require('node:sqlite'); console.log('sqlite-ok')"`);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('sqlite-ok');
    } finally {
      await sandbox.destroy();
    }
  }, 300_000);

  it.skipIf(skip)('volume writes persist to a sandbox mounted right after destroy()', async () => {
    const provider: any = modal({});
    const name = `csdk-vol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mountPath = '/mnt/csdk-vol';
    const volume = await provider.volume.create({ name });
    try {
      const writer = await provider.sandbox.create({ volumes: [{ volume, mountPath }] });
      const w = await writer.runCommand(
        `mkdir -p ${mountPath}/small && head -c 1048576 /dev/urandom > ${mountPath}/seq.bin && ` +
        `for i in 1 2 3; do echo $i > ${mountPath}/small/f$i; done && sha256sum ${mountPath}/seq.bin | cut -d' ' -f1`
      );
      expect(w.exitCode).toBe(0);
      const digest = w.stdout.trim();
      await writer.destroy();

      const reader = await provider.sandbox.create({ volumes: [{ volume, mountPath }] });
      try {
        const r = await reader.runCommand(`sha256sum ${mountPath}/seq.bin | cut -d' ' -f1 && cat ${mountPath}/small/f*`);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toBe(`${digest}\n1\n2\n3\n`);
      } finally {
        await reader.destroy();
      }
    } finally {
      await provider.volume.delete(name).catch(() => undefined);
    }
  }, 300_000);
});

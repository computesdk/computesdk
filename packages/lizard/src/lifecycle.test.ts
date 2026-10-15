import { describe, expect, it } from 'vitest';
import { lizard } from './index';

describe.skipIf(process.env.LIZARD_LIVE_TESTS !== '1')('Lizard live lifecycle', () => {
  it('reconnects, lists, serves a port and restores a snapshot', async () => {
    const provider = lizard({ size: 'small', timeout: 300000 });
    const source = await provider.instances.create({ metadata: { purpose: 'computesdk-tests' } });
    let restored: Awaited<ReturnType<typeof provider.instances.create>> | undefined;
    let snapshotId: string | undefined;
    try {
      expect((await provider.instances.getById(source.instanceId))?.instanceId).toBe(source.instanceId);
      expect((await provider.instances.list()).some(item => item.instanceId === source.instanceId)).toBe(true);
      await source.filesystem.writeFile('/tmp/provider-proof.txt', 'roundtrip');
      await source.runCommand('python -m http.server 8000 --bind 0.0.0.0', { background: true, cwd: '/tmp' });
      const url = await source.getUrl({ port: 8000 });
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const endpoint = new URL(url);
          endpoint.pathname = '/provider-proof.txt';
          // Browser URLs establish a cookie via redirect. API clients use the
          // same token as a header and do not need a browser cookie jar.
          const token = endpoint.searchParams.get('lizard_token');
          expect(Boolean(token)).toBe(true);
          endpoint.search = '';
          const response = await fetch(endpoint, {
            headers: { 'X-Lizard-Access-Token': token! },
            signal: AbortSignal.timeout(10000),
          });
          ready = response.ok && (await response.text()) === 'roundtrip';
        } catch { /* The HTTP server may still be starting. */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(ready).toBe(true);
      const snapshot = await provider.snapshot!.create(source.instanceId, { name: 'computesdk-integration-test' });
      snapshotId = snapshot.id;
      expect((await provider.snapshot!.list({ instanceId: source.instanceId })).some(item => item.id === snapshotId)).toBe(true);
      restored = await provider.instances.create({ snapshotId });
      expect(await restored.filesystem.readFile('/tmp/provider-proof.txt')).toBe('roundtrip');
      await restored.filesystem.remove('/tmp/provider-proof.txt');
      expect(await restored.filesystem.exists('/tmp/provider-proof.txt')).toBe(false);
    } finally {
      try { await restored?.destroy(); }
      finally {
        try { if (snapshotId) await provider.snapshot!.delete(snapshotId); }
        finally { await source.destroy(); }
      }
    }
  }, 240000);
});

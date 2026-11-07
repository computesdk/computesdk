import { createHash, randomBytes } from 'node:crypto';
import { ArkerError, type SyncWriteResponse } from '@arker-ai/sdk';
import { describe, expect, it } from 'vitest';
import { arker } from '../index';

describe.skipIf(!process.env.ARKER_API_KEY)('Arker large filesystem transfer (live)', () => {
  it('compares native chunk sync and adapter transfer of the 128 MiB benchmark payload', async () => {
    const provider = arker({ platforms: ['graviton4'] });
    const box = await provider.instances.create({ templateId: 'ubuntu-small' });
    const vm = box.getInstance();
    console.log('arker filesystem source', vm.id);
    try {
      const dir = `/root/arker-filesystem-${Date.now()}`;
      await box.filesystem.mkdir(dir);
      const small = Buffer.from('native-write');
      const smallResult = await vm._client._request<SyncWriteResponse>('POST', `/v1/vms/${vm.id}/sync`, {
        op: 'write', writes: [{ path: `${dir}/small`, size: small.length, upload_id: `csdk-${Date.now()}`, start: 0, end: small.length, content: small.toString('base64') }],
      }, vm.baseUrl);
      console.log('arker native small sync', JSON.stringify(smallResult));
      expect(smallResult.results[0]).toMatchObject({ complete: true, written: true });
      expect((await box.runCommand(`cat ${dir}/small`)).stdout).toBe(small.toString());

      const payload = randomBytes(128 * 1024 * 1024).toString('base64');
      const digest = createHash('sha256').update(payload).digest('hex');
      const bytes = Buffer.from(payload);
      const uploadId = `csdk-${Date.now()}`;
      console.log('arker before native large sync', vm.id, bytes.length, digest);
      for (let start = 0; start < bytes.length; start += 3 * 256 * 1024) {
        const end = Math.min(start + 3 * 256 * 1024, bytes.length);
        const result = await vm._client._request<SyncWriteResponse>('POST', `/v1/vms/${vm.id}/sync`, {
          op: 'write', writes: [{ path: `${dir}/native`, size: bytes.length, upload_id: uploadId, start, end, content: bytes.subarray(start, end).toString('base64') }],
        }, vm.baseUrl);
        expect(result.ok).toBe(true);
        expect(result.results[0]?.error).toBeFalsy();
        if (end === bytes.length) expect(result.results[0]).toMatchObject({ complete: true, written: true });
      }
      const native = await box.runCommand(`sha256sum ${dir}/native; wc -c < ${dir}/native`);
      console.log('arker native large result', vm.id, JSON.stringify(native));
      expect(native.stdout).toBe(`${digest}  ${dir}/native\n${bytes.length}\n`);

      for (const size of [40 * 1024, 1024 * 1024, 16 * 1024 * 1024, 64 * 1024 * 1024]) {
        console.log('arker before accumulated write', vm.id, size);
        await box.filesystem.writeFile(`${dir}/previous`, randomBytes(size).toString('base64'));
        await box.filesystem.remove(`${dir}/previous`);
      }
      console.log('arker before adapter large write', vm.id, payload.length, digest);
      await box.filesystem.writeFile(`${dir}/adapter`, payload);
      const adapter = await box.runCommand(`sha256sum ${dir}/adapter; wc -c < ${dir}/adapter; awk '/MemAvailable/{print}' /proc/meminfo`);
      console.log('arker adapter large result', vm.id, JSON.stringify(adapter));
      expect(adapter.stdout).toContain(`${digest}  ${dir}/adapter\n${bytes.length}\n`);
      console.log('arker before adapter large read', vm.id);
      expect(await box.filesystem.readFile(`${dir}/adapter`)).toBe(payload);
    } finally {
      console.log('arker before filesystem cleanup', vm.id);
      await box.destroy();
      const state = await vm._client.getVm(vm.id).then(() => 'exists', (err: unknown) => {
        if (err instanceof ArkerError && err.status === 404) return '404';
        throw err;
      });
      console.log('arker filesystem cleanup status', vm.id, state);
      expect(state).toBe('404');
    }
  }, 300_000);
});

// The shared test utilities load the repository root .env file.
import '@computesdk/test-utils';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { boat, getBoatUrl, readBoatFile, writeBoatFile } from '../index';

const runLive = Boolean(process.env.BOAT_API_KEY);

it.skipIf(!runLive)('Boat signed transfers, preview routing, and named snapshot restore', async () => {
  const provider = boat({ createOptions: { type: 'small', noEnv: true }, timeout: 1_200_000 });
  const sandbox = await provider.instances.create({ name: 'computesdk-integration' });
  const id = sandbox.getInstance().id;
  let snapshotName: string | undefined;
  let restored: Awaited<ReturnType<typeof provider.instances.create>> | undefined;
  try {
    console.log('Boat live: signed file transfers');
    const dir = "/tmp/computesdk ' $ files";
    await sandbox.filesystem.mkdir(dir);
    const large = '世界 hello\n'.repeat(600_000);
    await sandbox.filesystem.writeFile(`${dir}/large.txt`, large);
    expect(await sandbox.filesystem.readFile(`${dir}/large.txt`)).toBe(large);
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    await writeBoatFile(sandbox.getInstance(), `${dir}/binary`, bytes);
    expect(await readBoatFile(sandbox.getInstance(), `${dir}/binary`)).toEqual(bytes);
    await sandbox.filesystem.remove(dir);
    console.log('Boat live: preview routing and localhost relay');
    await sandbox.filesystem.writeFile('/tmp/preview.txt', 'boat-preview-ok');
    await sandbox.runCommand('python3 -m http.server 8000 --bind 127.0.0.1', { background: true, cwd: '/tmp' });
    const preview = new URL(await getBoatUrl(sandbox.getInstance(), { port: 8000, localhost: true }));
    expect(preview.protocol).toBe('https:');
    expect(preview.searchParams.has('_token')).toBe(true);
    const fileUrl = new URL(preview); fileUrl.pathname = '/preview.txt';
    const previewToken = fileUrl.searchParams.get('_token')!;
    fileUrl.searchParams.delete('_token');
    const deadline = Date.now() + 90_000;
    let previewText = '';
    while (Date.now() < deadline) {
      try {
        const response = await fetch(fileUrl, { headers: { Cookie: `_port_auth=${previewToken}` }, signal: AbortSignal.timeout(10_000) });
        previewText = response.ok ? await response.text() : `HTTP ${response.status}`;
      } catch { previewText = 'not ready'; }
      if (previewText === 'boat-preview-ok') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    expect(previewText).toBe('boat-preview-ok');
    const publicUrl = new URL(await getBoatUrl(sandbox.getInstance(), { port: 8000, localhost: true, public: true }));
    expect(publicUrl.searchParams.has('_token')).toBe(false);
    publicUrl.pathname = '/preview.txt';
    expect(await (await fetch(publicUrl, { signal: AbortSignal.timeout(10_000) })).text()).toBe('boat-preview-ok');
    console.log('Boat live: named snapshot save and restore');
    await sandbox.filesystem.writeFile('/home/user/computesdk-restore.txt', 'boat-restore-ok');
    snapshotName = `compute-live-${randomUUID()}`;
    const snapshot = await provider.snapshot.create(id, { name: snapshotName });
    expect(snapshot.status).toBe('ready');
    expect(await provider.snapshot.list({ instanceId: id })).toEqual(expect.arrayContaining([expect.objectContaining({ id: snapshot.id })]));
    expect(await provider.template.list()).toEqual(expect.arrayContaining([expect.objectContaining({ templateId: snapshot.id })]));
    restored = await provider.instances.create({ snapshotId: snapshot.id });
    expect(await restored.filesystem.readFile('/home/user/computesdk-restore.txt')).toBe('boat-restore-ok');
    expect(await restored.filesystem.exists('/tmp/preview.txt')).toBe(false);
  } finally {
    // Attempt every cleanup even if one fails, and report cleanup errors to the test runner.
    const cleanup = await Promise.allSettled([
      sandbox.destroy(),
      ...(restored ? [restored.destroy()] : []),
      ...(snapshotName ? [provider.snapshot.delete(snapshotName)] : []),
    ]);
    const failed = cleanup.filter(result => result.status === 'rejected');
    expect(failed, 'Boat live resource cleanup').toEqual([]);
  }
}, 1_200_000);

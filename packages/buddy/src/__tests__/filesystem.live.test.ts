import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { escapeShellArg } from '@computesdk/provider';

import { buddy } from '../index';
import { isNotFound, statusOf, type BuddySandboxHandle } from '../utils';

const live = Boolean(process.env.BUDDY_TOKEN && process.env.BUDDY_WORKSPACE && process.env.BUDDY_PROJECT);

describe.skipIf(!live)('native filesystem comparison', () => {
  it('reads preserved links through the filesystem API before and after a snapshot', async () => {
    const provider = buddy({});
    const source = await provider.instances.create({ name: `buddy-fs-${Date.now()}`, timeout: 600_000 });
    const handle = source.getInstance() as BuddySandboxHandle;
    console.log('BUDDY_FS_SOURCE', handle.sandboxId);
    const instances = [source];
    let snapshotId: string | undefined;
    const originalSnapshot = handle.client.addSandboxSnapshot.bind(handle.client);
    handle.client.addSandboxSnapshot = async data => {
      const created = await originalSnapshot(data);
      snapshotId = created.id;
      console.log('BUDDY_FS_SNAPSHOT', snapshotId);
      return created;
    };
    try {
      const base = `/buddy/fs-link-${Date.now()}`;
      const payload = 'buddy-link-payload\n';
      await source.filesystem.mkdir(base);
      const conflict = await handle.fs.createFolder(base).then(() => undefined, error => statusOf(error));
      console.log('BUDDY_FS_NATIVE_MKDIR', handle.sandboxId, conflict);
      expect(conflict).toBe(409);
      for (const bytes of [1024 ** 2, 64 * 1024 ** 2]) {
        await source.filesystem.mkdir(base);
        const data = Buffer.alloc(bytes, 97).toString('base64');
        const path = `${base}/large.bin.b64`;
        await source.filesystem.writeFile(path, data);
        const readback = await source.filesystem.readFile(path);
        const digest = (text: string) => createHash('sha256').update(text).digest('hex');
        console.log('BUDDY_FS_READBACK', JSON.stringify({ id: handle.sandboxId, bytes, length: readback.length, expectedHash: digest(data), actualHash: digest(readback) }));
        expect(readback.length).toBe(data.length);
        expect(digest(readback)).toBe(digest(data));
        await source.filesystem.remove(path);
      }
      const command = `true #${'x'.repeat(16_384)}`;
      const nativeLimit = await handle.client.executeCommand({
        path: { sandbox_id: handle.sandboxId }, body: { command, runtime: 'BASH' },
      }).then(() => undefined, error => ({ status: statusOf(error), message: String(error) }));
      const adapterLimit = await source.runCommand(command, { timeout: 10_000 }).then(
        () => undefined, error => ({ status: statusOf(error), message: String(error) }),
      );
      console.log('BUDDY_FS_EXEC_LIMIT', JSON.stringify({ id: handle.sandboxId, bytes: command.length, nativeLimit, adapterLimit }));
      expect(nativeLimit?.status).toBe(400);
      expect(adapterLimit?.status).toBe(400);
      await source.filesystem.writeFile(`${base}/not-a-directory`, 'file');
      await expect(source.filesystem.mkdir(`${base}/not-a-directory`)).rejects.toMatchObject({ statusCode: 409 });
      await source.filesystem.writeFile(`${base}/payload.txt`, payload);
      const quote = (path: string) => `"${escapeShellArg(path)}"`;
      const quotedFile = `payload "with' quotes" $.txt`;
      const quotedLink = `link "with' quotes" $.txt`;
      await source.filesystem.writeFile(`${base}/${quotedFile}`, payload);
      await source.filesystem.mkdir(`${base}/nested`);
      expect((await source.runCommand([
        `ln -s payload.txt ${quote(`${base}/relative.txt`)}`,
        `ln -s ${quote(`${base}/payload.txt`)} ${quote(`${base}/absolute.txt`)}`,
        `ln -s ../relative.txt ${quote(`${base}/nested/link.txt`)}`,
        `ln -s ${quote(quotedFile)} ${quote(`${base}/${quotedLink}`)}`,
        `ln -s missing.txt ${quote(`${base}/dangling.txt`)}`,
        `ln -s loop.txt ${quote(`${base}/loop.txt`)}`,
      ].join(' && '))).exitCode).toBe(0);

      const compare = async (instance: typeof source, phase: string) => {
        const native = instance.getInstance() as BuddySandboxHandle;
        await instance.filesystem.exists(`${base}/payload.txt`);
        for (const name of ['payload.txt', 'relative.txt', 'absolute.txt', 'nested/link.txt', quotedLink]) {
          const path = `${base}/${name}`;
          const exec = await instance.runCommand(`readlink ${quote(path)}; cat ${quote(path)}`);
          const download = await native.fs.downloadFile(path).then(
            buffer => ({ bytes: buffer.length, hex: buffer.subarray(0, 64).toString('hex') }),
            error => ({ status: statusOf(error), error: String(error) }),
          );
          const adapter = await instance.filesystem.readFile(path).catch(error => `ERROR: ${String(error)}`);
          console.log('BUDDY_FS_COMPARE', JSON.stringify({ phase, id: native.sandboxId, path, exec, download, adapter }));
          expect(exec.exitCode).toBe(0);
          expect(exec.stdout.endsWith(payload)).toBe(true);
          expect(adapter).toBe(payload);
        }
        await expect(instance.filesystem.readFile(`${base}/missing.txt`)).rejects.toThrow();
        await expect(instance.filesystem.readFile(`${base}/dangling.txt`)).rejects.toThrow();
        await expect(instance.filesystem.readFile(`${base}/loop.txt`)).rejects.toThrow();
      };
      await compare(source, 'source');
      const snapshot = await provider.snapshot!.create(source.instanceId);
      snapshotId = snapshot.id;
      console.log('BUDDY_FS_RESTORE_FROM', snapshotId);
      const restored = await provider.instances.create({ snapshotId, timeout: 600_000 });
      instances.push(restored);
      console.log('BUDDY_FS_RESTORED', restored.instanceId);
      await compare(restored, 'restored');
      expect(await restored.filesystem.readFile(`${base}/relative.txt`)).toBe(payload);
      expect(await restored.filesystem.readFile(`${base}/absolute.txt`)).toBe(payload);
    } finally {
      handle.client.addSandboxSnapshot = originalSnapshot;
      const cleanupErrors: unknown[] = [];
      if (snapshotId) await (async () => {
        console.log('BUDDY_FS_DELETE_SNAPSHOT', snapshotId);
        await provider.snapshot!.delete(snapshotId);
        const absent = await handle.client.getSandboxSnapshot({
          path: { sandbox_id: handle.sandboxId, id: snapshotId! },
        }).then(() => false, error => {
          console.log('BUDDY_FS_SNAPSHOT_STATUS', snapshotId, statusOf(error));
          return isNotFound(error);
        });
        expect(absent).toBe(true);
      })().catch(error => cleanupErrors.push(error));
      for (const instance of instances.reverse()) {
        await (async () => {
          console.log('BUDDY_FS_DELETE_INSTANCE', instance.instanceId);
          await instance.destroy();
          expect(await provider.instances.getById(instance.instanceId)).toBeNull();
          console.log('BUDDY_FS_INSTANCE_ABSENT', instance.instanceId);
        })().catch(error => cleanupErrors.push(error));
      }
      expect(cleanupErrors).toEqual([]);
    }
  }, 600_000);
});

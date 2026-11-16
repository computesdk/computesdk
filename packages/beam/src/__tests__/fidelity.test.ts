import { describe, expect, test } from 'vitest';
import { beam } from '../index';

describe.skipIf(!process.env.BEAM_TOKEN || !process.env.BEAM_WORKSPACE_ID)('beam live fidelity', () => {
  test('preserves the full fidelity payload, live source, and snapshot isolation', async () => {
    const provider = beam({});
    const source = await provider.sandbox.create({ name: 'computesdk-fidelity', runtime: 'node' });
    const runId = Date.now().toString(36);
    const dir = `/root/bench-fidelity-${runId}`;
    const payload = `fidelity-content-${runId}`;
    const large = 'abcdefgh'.repeat(32 * 1024);
    const tmp = `/tmp/fidelity-${runId}.txt`;
    let restoredId: string | undefined;
    let snapshotId: string | undefined;

    const diagnoseLink = async (sandbox: typeof source) => {
      const [api, shell] = await Promise.all([
        sandbox.filesystem.readFile(`${dir}/link.txt`).then(
          (value) => ({ value }),
          (error: Error) => ({ error: error.message }),
        ),
        sandbox.runCommand(`ls -l '${dir}/link.txt'; readlink '${dir}/link.txt'; cat '${dir}/link.txt'`),
      ]);
      return { api, shell };
    };

    try {
      await source.filesystem.mkdir(dir);
      await Promise.all([
        source.filesystem.writeFile(`${dir}/payload.txt`, payload),
        source.filesystem.writeFile(`${dir}/large.bin`, large),
        source.filesystem.writeFile(`${dir}/mutated-target.txt`, 'delete-me'),
        source.filesystem.writeFile(`${dir}/run.sh`, `#!/bin/sh\necho exec-ok-${runId}\n`),
        source.filesystem.writeFile(tmp, `tmpfs-${runId}`),
      ]);
      const setup = await source.runCommand(`chmod +x '${dir}/run.sh' && ln -sf '${dir}/payload.txt' '${dir}/link.txt'`);
      expect(setup.exitCode).toBe(0);
      const pkg = await source.runCommand(
        `cd '${dir}' && npm init -y >/dev/null 2>&1 && npm i is-number@7 --no-audit --no-fund >/dev/null 2>&1; echo PKG:$?`,
        { timeout: 120_000 },
      );
      const heartbeat = await source.runCommand(
        `nohup sh -c 'while :; do echo t >> ${dir}/heartbeat.log; sleep 1; done' >/dev/null 2>&1 &`,
        { timeout: 30_000 },
      );
      expect(heartbeat.exitCode).toBe(0);
      const before = await diagnoseLink(source);
      console.log('beam fidelity before snapshot', JSON.stringify(before));

      const snapshot = await provider.snapshot!.create(source.sandboxId, { name: `fidelity-${runId}` });
      snapshotId = snapshot.id;
      expect(snapshot.id).not.toBe(source.sandboxId);
      const live = await source.runCommand(`wc -l < '${dir}/heartbeat.log'; sleep 2; wc -l < '${dir}/heartbeat.log'`);
      const counts = live.stdout.trim().split(/\s+/).map(Number);
      expect(live.exitCode).toBe(0);
      expect(counts).toHaveLength(2);
      expect(counts[1]).toBeGreaterThan(counts[0]);

      await source.filesystem.writeFile(`${dir}/payload.txt`, `MUTATED-${runId}`);
      expect((await source.runCommand(`rm -f '${dir}/mutated-target.txt'`)).exitCode).toBe(0);
      await source.destroy();
      await new Promise((resolve) => setTimeout(resolve, 60_000));

      const restored = await provider.sandbox.create({ snapshotId: snapshot.id });
      restoredId = restored.sandboxId;
      expect(restoredId).not.toBe(source.sandboxId);
      const [text, big, link, tmpText, executable, isolation, process, packageCheck] = await Promise.all([
        restored.filesystem.readFile(`${dir}/payload.txt`),
        restored.filesystem.readFile(`${dir}/large.bin`),
        restored.filesystem.readFile(`${dir}/link.txt`).catch((error: Error) => ({ error: error.message })),
        restored.filesystem.readFile(tmp),
        restored.runCommand(`'${dir}/run.sh'`),
        restored.runCommand(`test -e '${dir}/mutated-target.txt'; echo ISO:$?`),
        restored.runCommand(`wc -l < '${dir}/heartbeat.log'; sleep 2; wc -l < '${dir}/heartbeat.log'`),
        restored.runCommand(`cd '${dir}' && node -e "process.stdout.write(String(require('is-number')(42)))" 2>/dev/null`),
      ]);
      const restoredCounts = process.stdout.trim().split(/\s+/).map(Number);
      const checks = {
        fileText: text === payload,
        fileLarge: big === large,
        executable: executable.stdout.includes(`exec-ok-${runId}`),
        symlink: link === payload,
        isolationOverwrite: text !== `MUTATED-${runId}`,
        isolationDelete: /\bISO:0\b/.test(isolation.stdout),
        tmpfs: tmpText === `tmpfs-${runId}`,
        package: /\bPKG:0\b/.test(pkg.stdout) ? packageCheck.stdout.trim() === 'true' : 'untested',
        processAlive: restoredCounts.length === 2 && restoredCounts[1] > restoredCounts[0],
      };
      console.log('beam fidelity restored', JSON.stringify({ checks, link: await diagnoseLink(restored) }));
      expect(checks).toMatchObject({
        fileText: true,
        fileLarge: true,
        executable: true,
        symlink: true,
        isolationOverwrite: true,
        isolationDelete: true,
      });
    } finally {
      await provider.sandbox.destroy(source.sandboxId).catch(() => {});
      if (restoredId) await provider.sandbox.destroy(restoredId).catch(() => {});
      if (snapshotId) await provider.snapshot!.delete(snapshotId);
    }
  }, 600_000);
});

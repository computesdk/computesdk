import { describe, it, expect } from 'vitest';
import { archil } from '../index';
import type { ArchilSandbox } from '../index';

const hasCreds = Boolean(process.env.ARCHIL_API_KEY && process.env.ARCHIL_REGION);
const hasDisk = hasCreds && Boolean(process.env.ARCHIL_DISK_ID);

function provider(execution: 'exec' | 'persistent') {
  return archil({
    apiKey: process.env.ARCHIL_API_KEY,
    region: process.env.ARCHIL_REGION,
    execution,
  });
}

describe.skipIf(!hasDisk)('archil live: exec mode', () => {
  it('runs compound shell commands', async () => {
    const sandbox = await provider('exec').sandbox.create({
      diskId: process.env.ARCHIL_DISK_ID,
    });
    const subshell = await sandbox.runCommand('(echo a; echo b) | wc -l');
    expect(subshell.stderr).toBe('');
    expect(subshell.exitCode).toBe(0);
    expect(subshell.stdout.trim()).toBe('2');

    const group = await sandbox.runCommand('{ echo "$HOME"; }', {
      env: { HOME: '/root' },
    });
    expect(group.exitCode).toBe(0);
    expect(group.stdout.trim()).toBe('/root');
  }, 120_000);
});

describe.skipIf(!hasCreds)('archil live: default persistent VM', () => {
  it('creates a VM by default, pauses/resumes it, and forks snapshots that restore state', async () => {
    const previousExecution = process.env.ARCHIL_EXECUTION;
    delete process.env.ARCHIL_EXECUTION;
    const p = archil({
      apiKey: process.env.ARCHIL_API_KEY,
      region: process.env.ARCHIL_REGION,
    });
    const marker = `marker-${Date.now()}`;
    const created: string[] = [];
    let snapshotId: string | undefined;
    try {
      const sandbox = await p.sandbox.create({ maxTtlSeconds: 600 });
      created.push(sandbox.sandboxId);
      const handle = sandbox.getInstance() as ArchilSandbox;
      // No disk id and no execution option: a persistent VM, not a disk handle.
      expect(handle.vm?.id).toBe(sandbox.sandboxId);
      expect(sandbox.sandboxId.startsWith('dsk-')).toBe(false);
      expect(sandbox.processRuntime).toEqual({ streaming: 'native', processes: 'native' });

      await sandbox.filesystem.writeFile('/root/marker.txt', marker);
      const compound = await sandbox.runCommand('echo "$A"; (echo "$A") && pwd', {
        cwd: '/root',
        env: { A: 'set' },
      });
      expect(compound.stdout).toBe('set\nset\n/root\n');

      expect(typeof handle.pause).toBe('function');
      await handle.pause!();
      await handle.vm!.refresh();
      expect(handle.vm!.status).toBe('paused');
      await handle.resume!();

      const after = await sandbox.runCommand('cat /root/marker.txt');
      expect(after.exitCode).toBe(0);
      expect(after.stdout.trim()).toBe(marker);
      expect(handle.vm!.id).toBe(sandbox.sandboxId);

      const snapshot = await p.snapshot!.create(sandbox.sandboxId, {
        name: `snap-${Date.now()}`,
      });
      snapshotId = snapshot.id;
      expect(snapshot.id).not.toBe(sandbox.sandboxId);
      const snapshots = await p.snapshot!.list();
      expect(snapshots.map((s: { id: string }) => s.id)).toContain(snapshot.id);
      expect((await p.sandbox.list()).map((s) => s.sandboxId)).not.toContain(snapshot.id);

      await sandbox.filesystem.writeFile('/root/marker.txt', 'mutated');

      const restored = await p.sandbox.create({ snapshotId: snapshot.id });
      created.push(restored.sandboxId);
      expect(await restored.filesystem.readFile('/root/marker.txt')).toBe(marker);
      expect(await sandbox.filesystem.readFile('/root/marker.txt')).toBe('mutated');
    } finally {
      if (previousExecution !== undefined) process.env.ARCHIL_EXECUTION = previousExecution;
      // Forks must be deleted before the sandbox they were forked from:
      // restored VM, then the snapshot fork, then the parent.
      const [parent, ...children] = created;
      for (const id of children) {
        await p.sandbox.destroy(id).catch(() => undefined);
      }
      if (snapshotId) await p.snapshot!.delete(snapshotId).catch(() => undefined);
      if (parent) await p.sandbox.destroy(parent).catch(() => undefined);
    }
  }, 600_000);
});

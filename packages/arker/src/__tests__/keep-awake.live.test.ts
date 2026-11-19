import type { VM } from '@arker-ai/sdk';
import { describe, expect, it } from 'vitest';
import { arker } from '../index';

const live = !!process.env.ARKER_API_KEY;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes a line every 0.1 s; a command leaves it running and returns at once. */
const WRITER = `setsid nohup sh -c 'while :; do echo x >> /tmp/keep-awake.log; sleep 0.1; done' > /dev/null 2>&1 < /dev/null &`;

describe.skipIf(!live)('Arker keep-awake (live)', () => {
  const provider = arker({});

  const lines = async (sandbox: { runCommand: (c: string) => Promise<{ stdout: string }> }) =>
    Number((await sandbox.runCommand('wc -l < /tmp/keep-awake.log')).stdout.trim());

  it('keeps a background process running between commands, in a restore too', async () => {
    const source = await provider.instances.create();
    let snapshotId: string | undefined;
    let restored: Awaited<ReturnType<typeof provider.instances.create>> | undefined;
    try {
      await source.runCommand(WRITER);
      const before = await lines(source);
      await sleep(3000);
      // 30 lines if it ran the whole time; a VM paused between commands adds about one.
      expect(await lines(source)).toBeGreaterThanOrEqual(before + 20);

      snapshotId = (await provider.snapshot!.create(source.instanceId)).id;
      restored = await provider.instances.create({ snapshotId });
      const first = await lines(restored);
      await sleep(3000);
      expect(await lines(restored)).toBeGreaterThanOrEqual(first + 20);
      // Only the restore's own hold is live: the one copied from the source was ended.
      const vm = restored.getInstance() as VM;
      const live = await Promise.all((['pending', 'running'] as const).map((state) => vm.listRuns({ state })));
      const holds = live.flatMap(({ runs }) => runs).filter((r) => r.command?.startsWith(': computesdk-keep-awake'));
      expect(holds).toHaveLength(1);
    } finally {
      await restored?.destroy().catch(() => {});
      if (snapshotId) await provider.snapshot!.delete(snapshotId).catch(() => {});
      await source.destroy().catch(() => {});
    }
  }, 120_000);

  it('ends the hold at the sandbox timeout, after which the VM pauses between commands', async () => {
    const sandbox = await provider.instances.create({ timeout: 15_000 });
    try {
      await sandbox.runCommand('true');
      const vm = sandbox.getInstance() as VM;
      const holds = async () => {
        const live = await Promise.all((['pending', 'running'] as const).map((state) => vm.listRuns({ state })));
        return live.flatMap(({ runs }) => runs).filter((r) => r.command?.startsWith(': computesdk-keep-awake')).length;
      };
      await sleep(5_000);
      expect(await holds()).toBe(1);
      await sleep(20_000);
      expect(await holds()).toBe(0);
      const deadline = Date.now() + 30_000;
      while ((await vm.refresh()).state !== 'idle' && Date.now() < deadline) await sleep(1_000);
      expect((await vm.refresh()).state).toBe('idle');
    } finally {
      await sandbox.destroy().catch(() => {});
    }
  }, 120_000);
});

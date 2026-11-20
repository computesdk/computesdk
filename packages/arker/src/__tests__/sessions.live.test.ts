import { describe, expect, it } from 'vitest';
import { arker } from '../index';

const live = !!process.env.ARKER_API_KEY;

describe.skipIf(!live)('Arker concurrent commands (live)', () => {
  it('runs commands issued together at the same time', async () => {
    const sandbox = await arker({ keepAwake: false }).instances.create();
    try {
      await sandbox.runCommand('true');
      const started = Date.now();
      const results = await Promise.all([1, 2, 3].map((i) => sandbox.runCommand(`sleep 3; echo ${i}`)));
      const elapsed = Date.now() - started;
      expect(results.map((r) => r.stdout.trim())).toEqual(['1', '2', '3']);
      // One after another would take at least 9 s.
      expect(elapsed).toBeLessThan(7000);
    } finally {
      await sandbox.destroy();
    }
  }, 120_000);

  it('keeps a concurrent command\'s cd and export out of the next one', async () => {
    const sandbox = await arker({ keepAwake: false }).instances.create();
    try {
      const start = (await sandbox.runCommand('pwd')).stdout;
      // Each pair runs together, so the second of each borrows another session.
      const [, moved] = await Promise.all([
        sandbox.runCommand('sleep 2'),
        sandbox.runCommand('cd /tmp && export LEAK=1 && pwd'),
      ]);
      expect(moved.stdout).toBe('/tmp\n');
      const [, after] = await Promise.all([
        sandbox.runCommand('sleep 2'),
        sandbox.runCommand('pwd; echo "leak=${LEAK:-}"'),
      ]);
      expect(after.stdout).toBe(`${start}leak=\n`);
    } finally {
      await sandbox.destroy();
    }
  }, 120_000);
});

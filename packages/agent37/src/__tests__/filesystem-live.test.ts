import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agent37 } from '../index';

const provider = agent37({});

describe.skipIf(!process.env.AGENT37_API_KEY)('Agent37 filesystem transfers (live)', () => {
  let sandbox: Awaited<ReturnType<typeof provider.sandbox.create>>;
  const directory = `/tmp/computesdk-agent37-transfer-${randomUUID()}`;
  const requestSizes: number[] = [];
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/exec') && typeof init?.body === 'string') {
        requestSizes.push(Buffer.byteLength(init.body));
      }
      return originalFetch(input, init);
    });
    sandbox = await provider.sandbox.create({ templateId: 'agent37-base' });
  }, 120_000);

  afterAll(async () => {
    try {
      if (sandbox) await sandbox.destroy();
    } finally {
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('reproduces the fidelity concurrent 256 KiB write and verifies every byte by readback and remote hash', async () => {
    const files = [
      ['payload.txt', 'fidelity-content-agent37-transfer'],
      ['large.bin', 'x'.repeat(256 * 1024)],
      ['mutated-target.txt', 'delete-me-agent37-transfer'],
      ['run.sh', '#!/bin/sh\necho exec-ok-agent37-transfer\n'],
    ];
    await Promise.all(files.map(([name, content]) => sandbox.filesystem.writeFile(`${directory}/${name}`, content)));
    for (const [name, content] of files) {
      expect(await sandbox.filesystem.readFile(`${directory}/${name}`)).toBe(content);
    }
    const hash = await sandbox.runCommand(`sha256sum ${directory}/large.bin && wc -c < ${directory}/large.bin`);
    expect(hash.exitCode).toBe(0);
    expect(hash.stdout).toContain(createHash('sha256').update(files[1][1]).digest('hex'));
    expect(hash.stdout.trim().split('\n').at(-1)).toBe('262144');
    expect(Math.max(...requestSizes)).toBeLessThan(128_000);
    console.log(`Agent37 fidelity transfer: 4/4 exact readbacks; large.bin=262144 bytes; SHA-256 verified; largest exec request=${Math.max(...requestSizes)} bytes`);
  }, 120_000);

  it('preserves UTF-8 across chunks, safely quotes paths, overwrites, and writes empty content', async () => {
    const path = `${directory}/nested "quotes" $dollar 'single'/file`;
    const content = 'a'.repeat(48 * 1024 - 1) + '😀漢字é\0\n'.repeat(4000);
    await sandbox.filesystem.writeFile(path, content);
    expect(await sandbox.filesystem.readFile(path)).toBe(content);
    await sandbox.filesystem.writeFile(path, 'short');
    expect(await sandbox.filesystem.readFile(path)).toBe('short');
    await sandbox.filesystem.writeFile(path, '');
    expect(await sandbox.filesystem.readFile(path)).toBe('');
    await sandbox.filesystem.writeFile(`${directory}/new-empty`, '');
    expect(await sandbox.filesystem.readFile(`${directory}/new-empty`)).toBe('');
  }, 120_000);

  it('does not interleave concurrent writes to one destination or leave staging files', async () => {
    const path = `${directory}/shared`;
    const contents = ['a'.repeat(256 * 1024), 'b'.repeat(200 * 1024)];
    await Promise.all(contents.map((content) => sandbox.filesystem.writeFile(path, content)));
    expect(contents).toContain(await sandbox.filesystem.readFile(path));
    const leftovers = await sandbox.runCommand(`find ${directory} -name '.computesdk-write-*' -print`);
    expect(leftovers.exitCode).toBe(0);
    expect(leftovers.stdout.trim()).toBe('');
  }, 120_000);

  it('rejects actual output-limit truncation instead of returning partial content', async () => {
    const path = `${directory}/over-read-limit`;
    await sandbox.filesystem.writeFile(path, 'x'.repeat(400 * 1024));
    await expect(sandbox.filesystem.readFile(path)).rejects.toThrow('larger than one command\'s output limit');
    expect(Math.max(...requestSizes)).toBeLessThan(128_000);
  }, 120_000);
});

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudflare } from '../index.js';

const sandboxUrl = process.env.CLOUDFLARE_SANDBOX_URL;
const sandboxApiKey =
  process.env.CLOUDFLARE_SANDBOX_API_KEY || process.env.SANDBOX_API_KEY;
const live = !!(sandboxUrl && sandboxApiKey);

if (!live && process.env.COMPUTESDK_REQUIRE_INTEGRATION === '1') {
  it('cloudflare integration tests require credentials', () => {
    throw new Error(
      'COMPUTESDK_REQUIRE_INTEGRATION=1 but cloudflare integration tests were skipped (missing credentials)'
    );
  });
}

describe.skipIf(!live)('cloudflare live', () => {
  const provider = cloudflare({
    sandboxUrl: sandboxUrl || '',
    sandboxApiKey: sandboxApiKey || '',
    timeout: 120_000,
  });
  let sandbox: Awaited<ReturnType<typeof provider.sandbox.create>>;

  beforeAll(async () => {
    sandbox = await provider.sandbox.create({ envs: { CF_LIVE: 'from-create' } });
  }, 180_000);

  afterAll(async () => {
    await sandbox?.destroy().catch(() => undefined);
  }, 60_000);

  it('runs commands with env, cwd and exit codes', async () => {
    const result = await sandbox.runCommand('echo "$CF_LIVE $EXTRA" && pwd', {
      env: { EXTRA: 'per-call' },
      cwd: '/tmp',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('from-create per-call\n/tmp\n');

    const failed = await sandbox.runCommand('echo oops >&2; exit 3');
    expect(failed.exitCode).toBe(3);
    expect(failed.stderr).toContain('oops');
  }, 120_000);

  it('keeps background commands running after the exec returns', async () => {
    const started = await sandbox.runCommand(
      'sh -c "sleep 2; echo done > /tmp/cf-live-bg"',
      { background: true }
    );
    expect(started.exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const read = await sandbox.runCommand('cat /tmp/cf-live-bg');
    expect(read.stdout.trim()).toBe('done');
  }, 120_000);

  it('round-trips files, directories and existence checks', async () => {
    const dir = '/tmp/cf-live-fs';
    await sandbox.filesystem.mkdir(dir);
    await sandbox.filesystem.writeFile(`${dir}/a.txt`, "it's ünïcode\n");
    await expect(sandbox.filesystem.readFile(`${dir}/a.txt`)).resolves.toBe(
      "it's ünïcode\n"
    );
    await expect(sandbox.filesystem.exists(`${dir}/a.txt`)).resolves.toBe(true);
    const entries = await sandbox.filesystem.readdir(dir);
    expect(entries.map((entry) => entry.name)).toContain('a.txt');
    await sandbox.filesystem.remove(dir);
    await expect(sandbox.filesystem.exists(dir)).resolves.toBe(false);
    await expect(sandbox.filesystem.readFile(`${dir}/a.txt`)).rejects.toThrow();
  }, 180_000);

  it('round-trips a multi-chunk file byte for byte', async () => {
    const content = Array.from(
      { length: 9 * 1024 * 1024 + 123 },
      (_, index) => String.fromCharCode(97 + ((index * 7) % 26))
    ).join('');
    const path = '/tmp/cf-live-large.txt';
    await sandbox.filesystem.writeFile(path, content);
    const sum = await sandbox.runCommand(`sha256sum ${path} | cut -d' ' -f1`);
    expect(sum.stdout.trim()).toBe(
      createHash('sha256').update(content).digest('hex')
    );
    const read = await sandbox.filesystem.readFile(path);
    expect(read.length).toBe(content.length);
    expect(read === content).toBe(true);
  }, 300_000);

  it('reconnects with getById', async () => {
    const again = await provider.sandbox.getById(sandbox.sandboxId);
    expect(again?.sandboxId).toBe(sandbox.sandboxId);
    const result = await again!.runCommand('test -f /tmp/cf-live-large.txt');
    expect(result.exitCode).toBe(0);
  }, 120_000);
});

/**
 * Sandock-specific checks against the real API, beyond the shared provider
 * suite. Skipped without SANDOCK_API_KEY.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderInstance } from '@computesdk/provider';
import { sandock } from '../index';

const provider = sandock({});

describe.skipIf(!process.env.SANDOCK_API_KEY)('sandock (live)', () => {
  let sandbox: ProviderInstance;

  beforeAll(async () => {
    sandbox = await provider.instances.create({ envs: { CREATE_ENV: 'from-create' }, timeout: 600_000 });
  }, 120_000);

  afterAll(async () => {
    await sandbox?.destroy();
  }, 60_000);

  it('reports the exit code the command really exited with', async () => {
    expect((await sandbox.runCommand('exit 3')).exitCode).toBe(3);
    expect((await sandbox.runCommand('sh -c "exit 42"')).exitCode).toBe(42);
    expect((await sandbox.runCommand('false')).exitCode).toBe(1);
    const ok = await sandbox.runCommand('echo fine >&2');
    expect(ok.exitCode).toBe(0);
    expect(ok.stderr).toBe('fine\n');
  }, 60_000);

  it('applies create-time env, per-command env and cwd', async () => {
    const r = await sandbox.runCommand('echo "$CREATE_ENV $CMD_ENV $(pwd)"', { env: { CMD_ENV: 'per-cmd' }, cwd: '/tmp' });
    expect(r.stdout.trim()).toBe('from-create per-cmd /tmp');
  }, 60_000);

  it('finds the sandbox by id and in the list, and returns null for an unknown id', async () => {
    expect((await provider.instances.getById(sandbox.instanceId))?.instanceId).toBe(sandbox.instanceId);
    expect((await provider.instances.list()).some((s) => s.instanceId === sandbox.instanceId)).toBe(true);
    expect(await provider.instances.getById('sdb-does-not-exist')).toBeNull();
  }, 60_000);

  it('round-trips file content exactly and keeps empty files distinct from missing ones', async () => {
    const content = 'line 1\r\nline 2\té\u{1F600}\n\n';
    await sandbox.filesystem.writeFile('/tmp/computesdk/nested/rt.txt', content);
    expect(await sandbox.filesystem.readFile('/tmp/computesdk/nested/rt.txt')).toBe(content);
    await sandbox.filesystem.writeFile('/tmp/computesdk/empty.txt', '');
    expect(await sandbox.filesystem.readFile('/tmp/computesdk/empty.txt')).toBe('');
    await expect(sandbox.filesystem.readFile('/tmp/computesdk/missing.txt')).rejects.toThrow(/no such file/);
    const entries = await sandbox.filesystem.readdir('/tmp/computesdk');
    expect(entries.find((e) => e.name === 'nested')?.type).toBe('directory');
    expect(entries.find((e) => e.name === 'empty.txt')).toMatchObject({ type: 'file', size: 0 });
  }, 60_000);

  it('reports a destroyed sandbox as gone', async () => {
    const extra = await provider.instances.create();
    await extra.destroy();
    expect(await provider.instances.getById(extra.instanceId)).toBeNull();
    // Destroying it again is not an error.
    await expect(provider.instances.destroy(extra.instanceId)).resolves.toBeUndefined();
  }, 120_000);
});

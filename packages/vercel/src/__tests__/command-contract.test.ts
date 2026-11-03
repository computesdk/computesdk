import { spawnSync } from 'node:child_process';
import type { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ runCommand: vi.fn(), create: vi.fn(), get: vi.fn() }));
vi.mock('@vercel/sandbox', () => ({
  Sandbox: { create: native.create, get: native.get },
  Snapshot: {}, Drive: {},
}));
import { vercel } from '../index';

async function instance(existing = false) {
  const provider = vercel({ token: 'dummy', teamId: 'dummy', projectId: 'dummy' });
  return existing ? (await provider.instances.getById('local'))! : provider.instances.create();
}

// @vercel/sandbox 3.8.0: Session.runCommand pipes string log data to the
// supplied Writable sinks before returning CommandFinished (exitCode:number).
// Detached commands instead return Command (exitCode:number|null). Neither
// this adapter boundary nor the SDK status schema specifies a 0..255 limit.
describe('Vercel real-adapter command contract (native module mocked)', () => {
  beforeEach(() => {
    for (const key of ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID', 'VERCEL_OIDC_TOKEN', 'COMPUTESDK_API_KEY']) {
      vi.stubEnv(key, '');
    }
    native.create.mockReset().mockResolvedValue({ name: 'local', runCommand: native.runCommand });
    native.get.mockReset().mockResolvedValue({ name: 'local', runCommand: native.runCommand });
    native.runCommand.mockReset().mockImplementation(async (params: {
      cmd: string; args: string[]; stdout?: Writable; stderr?: Writable;
    }) => {
      const child = spawnSync(params.cmd, params.args, {
        input: '', encoding: 'utf8', timeout: 2_000, env: { PATH: '/usr/bin:/bin' },
      });
      if (child.error) throw child.error;
      params.stdout?.write(child.stdout);
      params.stderr?.write(child.stderr);
      return { exitCode: child.status };
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([false, true])('preserves real child nonzero and exact output (existing=%s)', async existing => {
    await expect((await instance(existing)).runCommand("printf 'out\\n\\n'; printf 'err\\n' >&2; exit 23"))
      .resolves.toMatchObject({ stdout: 'out\n\n', stderr: 'err\n', exitCode: 23 });
    expect(existing ? native.get : native.create).toHaveBeenCalledOnce();
  });

  it('accepts legitimate empty output only with completed status', async () => {
    await expect((await instance()).runCommand('true'))
      .resolves.toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
  });

  it.each([undefined, null, '0', false, NaN, Infinity, -Infinity, 0.5])(
    'rejects unknown/invalid foreground status %j even with empty sinks', async exitCode => {
      native.runCommand.mockResolvedValueOnce({ exitCode });
      await expect((await instance()).runCommand('secret-command')).rejects.toMatchObject({
        name: 'VercelCommandProtocolError', code: 'VERCEL_COMMAND_PROTOCOL_ERROR',
      });
    },
  );

  it.each([undefined, null])('rejects missing native result %j with a sanitized error', async result => {
    native.runCommand.mockResolvedValueOnce(result);
    await expect((await instance()).runCommand('secret-command')).rejects.toMatchObject({
      name: 'VercelCommandProtocolError', code: 'VERCEL_COMMAND_PROTOCOL_ERROR',
    });
  });

  it('never exposes command, partial output, or cause in introduced protocol errors', async () => {
    native.runCommand.mockImplementationOnce(async ({ stdout, stderr }) => {
      stdout.write('secret-output');
      stderr.write('secret-stderr');
      return { exitCode: 'secret-status' };
    });
    let caught: any;
    try { await (await instance()).runCommand('secret-command'); } catch (error) { caught = error; }
    expect(caught).toMatchObject({
      name: 'VercelCommandProtocolError', code: 'VERCEL_COMMAND_PROTOCOL_ERROR',
      message: 'Vercel command completion status is invalid.',
    });
    expect(caught.cause).toBeUndefined();
    expect(`${String(caught)} ${JSON.stringify(caught)}`).not.toContain('secret-');
  });

  it.each([-15, -1, 1, 23, 255, 256])('preserves numeric native exit domain %i', async exitCode => {
    native.runCommand.mockResolvedValueOnce({ exitCode });
    await expect((await instance()).runCommand('true'))
      .resolves.toMatchObject({ stdout: '', stderr: '', exitCode });
  });

  it.each([null, 0, 23, -15])('retains detached launch semantics for native status %j', async exitCode => {
    native.runCommand.mockResolvedValueOnce({ exitCode });
    await expect((await instance()).runCommand('true', { background: true }))
      .resolves.toMatchObject({ stdout: '', stderr: '', exitCode: exitCode ?? 0 });
    expect(native.runCommand.mock.calls[0][0]).toMatchObject({
      detached: true, stdout: undefined, stderr: undefined,
    });
  });

  it('does not treat an undefined detached result status as a native launch acknowledgement', async () => {
    native.runCommand.mockResolvedValueOnce({});
    await expect((await instance()).runCommand('true', { background: true })).rejects.toMatchObject({
      code: 'VERCEL_COMMAND_PROTOCOL_ERROR',
    });
  });

  it('retains timeout forwarding and legacy ordinary native failure behavior', async () => {
    native.runCommand.mockRejectedValueOnce(new Error('native transport unavailable'));
    await expect((await instance()).runCommand('true', { timeout: 1_501 }))
      .resolves.toMatchObject({ stdout: '', stderr: 'native transport unavailable', exitCode: 127 });
    expect(native.runCommand.mock.calls[0][0].timeoutMs).toBe(1_501);
  });
});

import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ run: vi.fn(), create: vi.fn(), connect: vi.fn() }));
vi.mock('@hopx-ai/sdk', () => ({
  Sandbox: { create: native.create, connect: native.connect },
}));
import { hopx } from '../index';

async function instance(existing = false) {
  const provider = hopx({ apiKey: 'dummy', baseURL: 'https://hopx.invalid' });
  return existing ? (await provider.instances.getById('local'))! : provider.instances.create();
}

// @hopx-ai/sdk 0.5.1 Commands.run returns HTTP response data directly, without
// validation. CommandResponse requires strings stdout/stderr and number
// exit_code; no 0..255 domain is specified. Native errors don't construct
// error.result, but the adapter's existing compatibility path must preserve
// valid completed command failures and validate malformed partial results.
describe('HopX real-adapter command contract (native module mocked)', () => {
  beforeEach(() => {
    for (const key of ['HOPX_API_KEY', 'COMPUTESDK_API_KEY']) vi.stubEnv(key, '');
    native.create.mockReset().mockResolvedValue({ sandboxId: 'local', commands: { run: native.run } });
    native.connect.mockReset().mockResolvedValue({ sandboxId: 'local', commands: { run: native.run } });
    native.run.mockReset().mockImplementation(async (command: string) => {
      const child = spawnSync('/bin/bash', ['-c', command], {
        input: '', encoding: 'utf8', timeout: 2_000, env: { PATH: '/usr/bin:/bin' },
      });
      if (child.error) throw child.error;
      return {
        success: child.status === 0, stdout: child.stdout, stderr: child.stderr,
        exit_code: child.status, execution_time: 0,
      };
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([false, true])('preserves real child nonzero and exact output (existing=%s)', async existing => {
    await expect((await instance(existing)).runCommand("printf 'out\\n\\n'; printf 'err\\n' >&2; exit 23"))
      .resolves.toMatchObject({ stdout: 'out\n\n', stderr: 'err\n', exitCode: 23 });
    expect(existing ? native.connect : native.create).toHaveBeenCalledOnce();
  });

  it('accepts legitimate empty stdout/stderr with completed status', async () => {
    await expect((await instance()).runCommand('true'))
      .resolves.toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
  });

  describe.each(['returned', 'error.result'])('%s native completion', path => {
    function respond(result: unknown) {
      if (path === 'returned') native.run.mockResolvedValueOnce(result);
      else native.run.mockRejectedValueOnce(Object.assign(new Error('secret-native-error'), { result }));
    }

    it.each([undefined, null, '0', false, NaN, Infinity, -Infinity, 0.5])(
      'rejects unknown/invalid status %j instead of inventing completion', async exit_code => {
        respond({ stdout: '', stderr: '', exit_code });
        await expect((await instance()).runCommand('secret-command')).rejects.toMatchObject({
          name: 'HopxCommandProtocolError', code: 'HOPX_COMMAND_PROTOCOL_ERROR',
        });
      },
    );

    it.each([undefined, null])('rejects missing result %j', async result => {
      respond(result);
      await expect((await instance()).runCommand('secret-command')).rejects.toMatchObject({
        name: 'HopxCommandProtocolError', code: 'HOPX_COMMAND_PROTOCOL_ERROR',
      });
    });

    it.each(path === 'returned' ? [-15, -1, 0, 1, 23, 255, 256] : [-15, -1, 1, 23, 255, 256])('preserves explicit completed exit status %i', async exit_code => {
      respond({ stdout: 'out', stderr: 'err', exit_code });
      await expect((await instance()).runCommand('true'))
        .resolves.toMatchObject({ stdout: 'out', stderr: 'err', exitCode: exit_code });
    });

    if (path === 'error.result') {
      it('rejects zero in a caught exception without a native successful-result contract', async () => {
        respond({ stdout: 'secret-output', stderr: 'secret-stderr', exit_code: 0 });
        let caught: any;
        try { await (await instance()).runCommand('secret-command'); } catch (error) { caught = error; }
        expect(caught).toMatchObject({
          name: 'HopxCommandProtocolError', code: 'HOPX_COMMAND_PROTOCOL_ERROR',
          message: 'HopX command completion status is invalid.',
        });
        expect(caught.cause).toBeUndefined();
        expect(`${String(caught)} ${JSON.stringify(caught)}`).not.toContain('secret-');
      });
    }

    it.each(['stdout', 'stderr'])('rejects malformed %s metadata with sanitized errors', async stream => {
      for (const value of [undefined, null, false, 0, { secret: 'secret-output' }, ['secret-output']]) {
        respond({ stdout: '', stderr: '', exit_code: 0, [stream]: value });
        let caught: any;
        try { await (await instance()).runCommand('secret-command'); } catch (error) { caught = error; }
        expect(caught).toMatchObject({
          name: 'HopxCommandProtocolError', code: 'HOPX_COMMAND_PROTOCOL_ERROR',
          message: 'HopX command output is invalid.',
        });
        expect(caught.cause).toBeUndefined();
        expect(`${String(caught)} ${JSON.stringify(caught)}`).not.toContain('secret-');
      }
    });

    it('does not leak command, output, native error, or invalid status', async () => {
      respond({ stdout: 'secret-output', stderr: 'secret-stderr', exit_code: 'secret-status' });
      let caught: any;
      try { await (await instance()).runCommand('secret-command'); } catch (error) { caught = error; }
      expect(caught).toMatchObject({
        name: 'HopxCommandProtocolError', code: 'HOPX_COMMAND_PROTOCOL_ERROR',
        message: 'HopX command completion status is invalid.',
      });
      expect(caught.cause).toBeUndefined();
      expect(`${String(caught)} ${JSON.stringify(caught)}`).not.toContain('secret-');
    });
  });

  it('keeps background launch shell semantics and requires its completed shell status', async () => {
    native.run.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 0 });
    await expect((await instance()).runCommand('true', { background: true }))
      .resolves.toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
    expect(native.run.mock.calls[0][0]).toBe('nohup true > /dev/null 2>&1 &');
    expect(native.run.mock.calls[0][1].background).toBeUndefined();
    native.run.mockResolvedValueOnce({ stdout: '', stderr: '' });
    await expect((await instance()).runCommand('true', { background: true })).rejects.toMatchObject({
      code: 'HOPX_COMMAND_PROTOCOL_ERROR',
    });
  });

  it('retains timeout conversion and legacy ordinary native failure behavior', async () => {
    native.run.mockRejectedValueOnce(new Error('native transport unavailable'));
    await expect((await instance()).runCommand('true', { timeout: 1_501 }))
      .resolves.toMatchObject({ stdout: '', stderr: 'native transport unavailable', exitCode: 127 });
    expect(native.run.mock.calls[0][1].timeout).toBe(2);
  });
});

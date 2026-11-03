import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blaxel } from '../index';

// Vendor-only boundary, @blaxel/core 0.3.21: streaming exec can return running;
// wait can resolve to stale running after a failed poll; stream EOF isn't exit.
const vendor = vi.hoisted(() => ({ get: vi.fn(), initialize: vi.fn() }));
vi.mock('@blaxel/core', () => ({
  initialize: vendor.initialize, SandboxInstance: { get: vendor.get },
  Snapshot: {}, VolumeInstance: {},
}));
type NativeResult = Record<string, unknown>;
type Callbacks = { onStdout?: (s: string) => void; onStderr?: (s: string) => void };
async function instance(result: unknown = { status: 'completed', exitCode: 0 }) {
  const process = {
    exec: vi.fn(async (_opts: Callbacks & { command: string }) => result),
    wait: vi.fn(async () => ({ status: 'completed', exitCode: 0 }) as NativeResult),
    logs: vi.fn(async (_pid: string, _channel: string) => ''),
    kill: vi.fn(async () => {}),
    streamLogs: vi.fn((_pid: string, _opts: Callbacks) => ({ close: vi.fn(), wait: vi.fn(async () => {}) })),
  };
  vendor.get.mockResolvedValue({ metadata: { name: 'local-command-contract' }, process });
  const sandbox = await blaxel({ apiKey: 'dummy', workspace: 'dummy' }).sandbox.getById('local-command-contract');
  expect(sandbox).not.toBeNull();
  return { sandbox: sandbox!, process };
}
const protocolError = {
  name: 'CommandResultProtocolError', code: 'COMMAND_RESULT_PROTOCOL_ERROR',
  message: 'Blaxel command did not return a valid terminal result',
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('Blaxel native command completion contract (offline)', () => {
  it.each(['completed', 'failed', 'stopped', 'killed'].flatMap(status =>
    [0, 23, -9, 256].map(exitCode => ({ status, exitCode }))
  ))('validates terminal status/code cross-product: %j', async ({ status, exitCode }) => {
    const { sandbox, process } = await instance({ status, exitCode, stdout: 'a\n\n', stderr: 'warning\n' });
    const result = sandbox.runCommand('one-side-effect');
    if (status === 'failed' && exitCode === 0) {
      await expect(result).rejects.toMatchObject(protocolError);
    } else {
      await expect(result).resolves.toMatchObject({ exitCode, stdout: 'a\n\n', stderr: 'warning\n' });
    }
    expect(process.exec).toHaveBeenCalledOnce();
    expect(process.wait).not.toHaveBeenCalled();
  });
  it('accepts ordinary empty completion with an explicit native zero', async () => {
    const { sandbox } = await instance({ status: 'completed', exitCode: 0 });
    await expect(sandbox.runCommand('true')).resolves.toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
  });
  it.each(['completed', 'failed', 'stopped', 'killed'].flatMap(status =>
    [undefined, null, NaN, Infinity, -Infinity, '0', false, 1.5].map(exitCode => ({ status, exitCode }))
  ))('rejects missing/invalid required numeric code for every terminal status: %j', async (result) => {
    const { sandbox, process } = await instance({
      ...result, pid: 'secret-pid', stdout: 'secret stdout', stderr: 'secret stderr',
    });
    const error = await sandbox.runCommand('secret command').then(() => null, (err: unknown) => err);
    expect(error).toMatchObject(protocolError);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret');
    expect(process.exec).toHaveBeenCalledOnce();
    expect(process.wait).not.toHaveBeenCalled();
    expect(process.logs).not.toHaveBeenCalled();
  });
  it.each([
    null, false, 'secret response', {}, { exitCode: 0 }, { status: 'running', exitCode: 0 },
    { status: 'secret remote status', exitCode: 0 }, { status: null, exitCode: 0 },

  ])('rejects unproven or invalid completion safely: %j', async (result) => {
    const { sandbox, process } = await instance(result);
    const error = await sandbox.runCommand('secret command').then(() => null, (err: unknown) => err);
    expect(error).toMatchObject(protocolError);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret');
    expect(process.exec).toHaveBeenCalledOnce();
  });
  it('waits with live logs before crediting a running result and preserves final chunks', async () => {
    vi.useFakeTimers();
    const { sandbox, process } = await instance({ status: 'running', pid: 'p1', exitCode: 0 });
    process.wait.mockImplementation(async () => {
      expect(process.streamLogs).toHaveBeenCalledOnce();
      return { status: 'completed', exitCode: 3 };
    });
    const close = vi.fn();
    process.streamLogs.mockImplementation((_pid, opts) => {
      const done = Promise.resolve().then(() => {
        opts.onStdout?.('last line');
        opts.onStderr?.('warning');
      });
      return { close, wait: vi.fn(() => done) };
    });
    await expect(sandbox.runCommand('work', { timeout: 15 })).resolves.toMatchObject({ exitCode: 3, stdout: 'last line\n', stderr: 'warning\n' });
    expect(process.wait).toHaveBeenCalledWith('p1', { maxWait: 15, interval: 500 });
    expect(close).toHaveBeenCalledOnce();
    expect(process.exec).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{}, { status: 'running', exitCode: 0 }, { status: 'secret status', exitCode: 0 }])('does not trust a resolved wait: %j', async (finished) => {
    const { sandbox, process } = await instance({ status: 'running', pid: 'secret-pid', exitCode: 0 });
    process.wait.mockResolvedValue(finished);
    process.kill.mockRejectedValue(new Error('best-effort kill failed'));
    await expect(sandbox.runCommand('work')).rejects.toMatchObject(protocolError);
    expect(process.kill).toHaveBeenCalledWith('secret-pid');
    expect(process.exec).toHaveBeenCalledOnce();
    expect(process.streamLogs.mock.results[0].value.close).toHaveBeenCalledOnce();
  });
  it('drains late stream bytes after terminal polling instead of returning early', async () => {
    vi.useFakeTimers();
    const { sandbox, process } = await instance({ status: 'running', pid: 'p1' });
    const close = vi.fn();
    process.streamLogs.mockImplementation((_pid, opts) => {
      const done = new Promise<void>((resolve) => setTimeout(() => {
        opts.onStdout?.('late tail');
        resolve();
      }, 5));
      return { close, wait: vi.fn(() => done) };
    });
    let settled = false;
    const result = sandbox.runCommand('work').then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(4);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ exitCode: 0, stdout: 'late tail\n' });
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds stream draining then closes and retains abort-flushed bytes', async () => {
    vi.useFakeTimers();
    const { sandbox, process } = await instance({ status: 'running', pid: 'p1' });
    const close = vi.fn();
    process.streamLogs.mockImplementation((_pid, opts) => {
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      close.mockImplementation(() => { opts.onStderr?.('tail at EOF'); finish(); });
      return { close, wait: vi.fn(() => done) };
    });
    const result = sandbox.runCommand('work');
    await vi.advanceTimersByTimeAsync(1999);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ exitCode: 0, stderr: 'tail at EOF\n' });
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never inherits a startup zero into a stopped final response lacking a code', async () => {
    const { sandbox, process } = await instance({ status: 'running', pid: 'p1', exitCode: 0 });
    process.wait.mockResolvedValue({ status: 'stopped' });
    await expect(sandbox.runCommand('work')).rejects.toMatchObject(protocolError);
    expect(process.exec).toHaveBeenCalledOnce();
  });
  it('allows status recovery when exec has a PID but no status', async () => {
    const { sandbox, process } = await instance({ pid: 'p1' });
    // ProcessResponse.exitCode is required by @blaxel/core 0.3.21; a
    // terminal label alone proves completion, not the numeric outcome.
    process.wait.mockResolvedValue({ status: 'completed', exitCode: 0 });
    await expect(sandbox.runCommand('work')).resolves.toMatchObject({ exitCode: 0 });
    expect(process.wait).toHaveBeenCalledOnce();
  });
  it.each(['exec', 'wait'] as const)('preserves native %s errors as legacy 127 with no replay', async (stage) => {
    const { sandbox, process } = await instance({ status: 'running', pid: 'p1' });
    process[stage].mockRejectedValue(new Error('native unavailable'));
    await expect(sandbox.runCommand('one-side-effect')).resolves.toMatchObject({ exitCode: 127, stdout: '', stderr: 'native unavailable' });
    expect(process.exec).toHaveBeenCalledOnce();
    if (stage === 'wait') expect(process.kill).toHaveBeenCalledWith('p1');
  });
  it('preserves native wait timeout and best-effort kill behavior', async () => {
    const { sandbox, process } = await instance({ status: 'running', pid: 'p1' });
    process.wait.mockRejectedValue(new Error('Process did not finish in time'));
    process.kill.mockRejectedValue(new Error('already exited'));
    await expect(sandbox.runCommand('slow', { timeout: 10 })).resolves.toMatchObject({ exitCode: 127, stderr: 'Process did not finish in time' });
    expect(process.wait).toHaveBeenCalledWith('p1', { maxWait: 10, interval: 500 });
    expect(process.kill).toHaveBeenCalledOnce();
  });
  it('retains exact callback chunks and best-effort log retrieval', async () => {
    const { sandbox, process } = await instance({ status: 'completed', exitCode: 0, pid: 'p1' });
    process.exec.mockImplementation(async opts => {
      opts.onStdout?.('one '); opts.onStdout?.('two\n');
      return { status: 'completed', exitCode: 0, pid: 'p1' };
    });
    process.logs.mockRejectedValue(new Error('gone'));
    await expect(sandbox.runCommand('work')).resolves.toMatchObject({ exitCode: 0, stdout: 'one two\n', stderr: '' });
    expect(process.exec).toHaveBeenCalledOnce();
  });
  it('retains background launch-shell semantics', async () => {
    const { sandbox, process } = await instance();
    await expect(sandbox.runCommand('worker', { background: true })).resolves.toMatchObject({ exitCode: 0 });
    expect(process.exec).toHaveBeenCalledWith(expect.objectContaining({ command: 'nohup worker > /dev/null 2>&1 &', waitForCompletion: true }));
    expect(process.exec).toHaveBeenCalledOnce();
    expect(process.kill).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beam } from '../index';

// Vendor-only boundary. Shapes follow beam-js 1.0.22 SandboxProcess:
// wait returns the numeric code; running is NOT refreshed by wait().
const vendor = vi.hoisted(() => ({ connect: vi.fn(), opts: {} }));
vi.mock('@beamcloud/beam-js', () => ({
  default: {}, beamOpts: vendor.opts,
  Sandbox: { connect: vendor.connect }, Image: {}, Volume: class {},
}));

function processHandle(exitCode: unknown = 0, stdout = '', stderr = '') {
  return {
    exitCode, running: true,
    wait: vi.fn(async () => exitCode),
    stdout: { read: vi.fn(async () => stdout) },
    stderr: { read: vi.fn(async () => stderr) },
    kill: vi.fn(async () => {}),
  };
}
async function instance(proc = processHandle()) {
  const native = { containerId: 'local-command-contract', exec: vi.fn(async () => proc) };
  vendor.connect.mockResolvedValue(native);
  const sandbox = await beam({ token: 'dummy', workspaceId: 'dummy' }).sandbox.getById(native.containerId);
  expect(sandbox).not.toBeNull();
  return { sandbox: sandbox!, native, proc };
}
const protocolError = {
  name: 'CommandResultProtocolError', code: 'COMMAND_RESULT_PROTOCOL_ERROR',
  message: 'Beam command did not return a valid completed exit code',
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('Beam native command completion contract (offline)', () => {
  it.each([0, 2, 127, 256])('preserves completed code %s and exact output without replay', async (code) => {
    const { sandbox, native, proc } = await instance(processHandle(code, 'a\n\n', 'warning\n'));
    await expect(sandbox.runCommand('one-side-effect')).resolves.toMatchObject({ exitCode: code, stdout: 'a\n\n', stderr: 'warning\n' });
    expect(native.exec).toHaveBeenCalledWith(['sh', '-c', 'one-side-effect'], { wait: true });
    expect(proc.wait).toHaveBeenCalledOnce();
  });
  it('accepts ordinary empty completion', async () => {
    const { sandbox } = await instance();
    await expect(sandbox.runCommand('true')).resolves.toMatchObject({ exitCode: 0, stdout: '', stderr: '' });
  });
  it('reads output only after wait and uses its authoritative returned code', async () => {
    const proc = processHandle(-1);
    let finished = false;
    proc.wait.mockImplementation(async () => { finished = true; return 7; });
    proc.stdout.read.mockImplementation(async () => { expect(finished).toBe(true); return 'tail'; });
    const { sandbox } = await instance(proc);
    await expect(sandbox.runCommand('work')).resolves.toMatchObject({ exitCode: 7, stdout: 'tail' });
  });
  it.each([0, 3])('rejects undefined wait even when the startup handle has code %s', async (code) => {
    const proc = processHandle(code);
    proc.wait.mockResolvedValue(undefined);
    const { sandbox, native } = await instance(proc);
    await expect(sandbox.runCommand('work')).rejects.toMatchObject(protocolError);
    expect(native.exec).toHaveBeenCalledOnce();
    expect(proc.stdout.read).not.toHaveBeenCalled();
    expect(proc.stderr.read).not.toHaveBeenCalled();
  });
  it.each([undefined, null, NaN, Infinity, -1, 1.5, '0', false])('rejects unknown/invalid completion %s safely', async (code) => {
    const proc = processHandle(code);
    proc.exitCode = code;
    proc.wait.mockResolvedValue(code);
    const { sandbox, native } = await instance(proc);
    const error = await sandbox.runCommand('secret command').then(() => null, (err: unknown) => err);
    expect(error).toMatchObject(protocolError);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret');
    expect(native.exec).toHaveBeenCalledOnce();
  });
  it.each(['exec', 'wait', 'stdout', 'stderr'] as const)('preserves native %s errors as legacy 127 without replay', async (stage) => {
    const { sandbox, native, proc } = await instance();
    const error = new Error('native unavailable');
    if (stage === 'exec') native.exec.mockRejectedValue(error);
    else if (stage === 'wait') proc.wait.mockRejectedValue(error);
    else proc[stage].read.mockRejectedValue(error);
    await expect(sandbox.runCommand('one-side-effect')).resolves.toMatchObject({ exitCode: 127, stdout: '', stderr: 'native unavailable' });
    expect(native.exec).toHaveBeenCalledOnce();
  });
  it('keeps timeout 124, partial output, and best-effort kill even with no completion code', async () => {
    vi.useFakeTimers();
    const proc = processHandle(undefined, 'partial', 'warning');
    proc.wait.mockImplementation(() => new Promise(() => {}));
    proc.kill.mockRejectedValue(new Error('already exited'));
    const { sandbox, native } = await instance(proc);
    const result = sandbox.runCommand('slow', { timeout: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ exitCode: 124, stdout: 'partial', stderr: 'Command timed out after 10ms\nwarning' });
    expect(native.exec).toHaveBeenCalledWith(['sh', '-c', 'slow'], { wait: false });
    expect(proc.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains background launch-shell semantics without replay or kill', async () => {
    const { sandbox, native, proc } = await instance();
    await expect(sandbox.runCommand('worker', { background: true })).resolves.toMatchObject({ exitCode: 0 });
    expect(native.exec).toHaveBeenCalledWith(['sh', '-c', 'nohup worker > /dev/null 2>&1 &'], { wait: true });
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

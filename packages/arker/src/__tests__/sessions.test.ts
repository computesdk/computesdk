import { Arker, ArkerError, type VM } from '@arker-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arker } from '../index';

const config = { apiKey: 'ark_test', keepAwake: false };

let nextId = 0;

/** A VM whose runs each wait until the test finishes them, as a long command would. */
function mockVm(opts: { createSession?: () => Promise<{ session_id: string }> } = {}) {
  let sessions = 0;
  const running: { command: string; session?: string; finish: () => void; fail: (err: Error) => void }[] = [];
  const vm = {
    id: `vm-sessions-${++nextId}`,
    createSession: vi.fn(opts.createSession ?? (async () => ({ session_id: `sess-${++sessions}` }))),
    run: vi.fn((command: string, options?: { session_id?: string }) =>
      new Promise((resolve, reject) => {
        // Commands arrive in a subshell; record what the caller ran.
        const ran = command.replace(/^\(\n([\s\S]*)\n\)$/, '$1');
        running.push({
          command: ran,
          session: options?.session_id,
          finish: () => resolve({ stdout: `${ran}\n`, stderr: '', exitCode: 0 }),
          fail: reject,
        });
      })),
    deleteSession: vi.fn(async (_sessionId: string) => ({ deleted: true })),
  };
  vi.spyOn(Arker.prototype, 'fork').mockResolvedValue(vm as unknown as VM);
  return { vm, running };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Arker command sessions (mock)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('runs sequential commands in the default session, with no extra calls', async () => {
    const { vm, running } = mockVm();
    const sandbox = await arker(config).instances.create();
    for (const command of ['echo 1', 'echo 2']) {
      const result = sandbox.runCommand(command);
      await settle();
      running.at(-1)!.finish();
      await result;
    }
    expect(running.map((r) => r.session)).toEqual([undefined, undefined]);
    expect(vm.createSession).not.toHaveBeenCalled();
  });

  it('runs a command that starts while another is running in a session of its own', async () => {
    const { vm, running } = mockVm();
    const sandbox = await arker(config).instances.create();
    const build = sandbox.runCommand('npm run build');
    const test = sandbox.runCommand('npm test');
    await settle();
    // Both are in flight at once, not queued one behind the other.
    expect(running.map((r) => [r.command, r.session])).toEqual([['npm run build', undefined], ['npm test', 'sess-1']]);
    running[1].finish();
    expect((await test).stdout).toBe('npm test\n');
    running[0].finish();
    await build;
    expect(vm.createSession).toHaveBeenCalledTimes(1);
  });

  it('reuses a freed session for the next concurrent command', async () => {
    const { vm, running } = mockVm();
    const sandbox = await arker(config).instances.create();
    const first = sandbox.runCommand('sleep 10');
    const second = sandbox.runCommand('echo a');
    await settle();
    running[1].finish();
    await second;
    const third = sandbox.runCommand('echo b');
    await settle();
    expect(running[2].session).toBe('sess-1');
    running[2].finish();
    running[0].finish();
    await Promise.all([first, third]);
    expect(vm.createSession).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a session whose command failed', async () => {
    const { vm, running } = mockVm();
    const sandbox = await arker(config).instances.create();
    const first = sandbox.runCommand('sleep 10');
    const failing = sandbox.runCommand('echo a');
    await settle();
    running[1].fail(new ArkerError('unavailable', 'lost', 503));
    await expect(failing).rejects.toMatchObject({ code: 'unavailable' });
    // It may still be running something, so it is set aside rather than reused,
    // and not deleted: that would end background processes started in it.
    expect(vm.deleteSession).not.toHaveBeenCalled();
    const next = sandbox.runCommand('echo b');
    await settle();
    expect(running[2].session).toBe('sess-2');
    running[2].finish();
    running[0].finish();
    await Promise.all([first, next]);
    expect(vm.createSession).toHaveBeenCalledTimes(2);
  });

  it('reuses a borrowed session whose command timed out once Arker has ended it', async () => {
    const { vm, running } = mockVm();
    const sandbox = await arker(config).instances.create();
    const first = sandbox.runCommand('sleep 60');
    const late = sandbox.runCommand('sleep 30', { timeout: 20 });
    await expect(late).rejects.toThrow(/timed out/);
    // Still busy until Arker kills it, so a new command gets another session.
    const other = sandbox.runCommand('echo a');
    await settle();
    expect(running[2].session).toBe('sess-2');
    // Arker ends the timed-out run; its session is free again while sess-2 is busy.
    running[1].finish();
    await settle();
    const again = sandbox.runCommand('echo b');
    await settle();
    expect(running[3].session).toBe('sess-1');
    running.slice(2).forEach((r) => r.finish());
    running[0].finish();
    await Promise.all([first, other, again]);
    expect(vm.createSession).toHaveBeenCalledTimes(2);
    expect(vm.deleteSession).not.toHaveBeenCalled();
  });

  it('keeps the default session for the next command after one in it timed out', async () => {
    const { running } = mockVm();
    const sandbox = await arker(config).instances.create();
    await expect(sandbox.runCommand('npm test', { timeout: 20 })).rejects.toThrow(/timed out/);
    const next = sandbox.runCommand('git status');
    await settle();
    // Same shell as before, so an earlier `cd` still holds; Arker queues it behind the dying run.
    expect(running[1].session).toBeUndefined();
    expect(running[1].command).toBe('git status');
    running.forEach((r) => r.finish());
    await next;
  });

  it('queues in the default session when the VM refuses another session', async () => {
    const { running } = mockVm({ createSession: async () => { throw new ArkerError('conflict', 'one session only', 409); } });
    const sandbox = await arker(config).instances.create();
    const first = sandbox.runCommand('sleep 10');
    const second = sandbox.runCommand('echo a');
    await settle();
    expect(running.map((r) => r.session)).toEqual([undefined, undefined]);
    running.forEach((r) => r.finish());
    await Promise.all([first, second]);
  });

  it('runs a concurrent command in a subshell, so the session it borrows does not keep its cwd and env', async () => {
    const { vm, running } = mockVm();
    const sandbox = await arker(config).instances.create();
    const first = sandbox.runCommand('cd /src');
    const second = sandbox.runCommand('make', { cwd: '/work', env: { A: '1' } });
    await settle();
    running.forEach((r) => r.finish());
    await Promise.all([first, second]);
    // Commands in turn keep the default session's state, as before.
    expect(vm.run.mock.calls[0][0]).toBe('cd /src');
    expect(vm.run.mock.calls[1][0]).toBe("(\nexport A='1'; cd '/work' && { make\n}\n)");
  });
});

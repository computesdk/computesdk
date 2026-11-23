import { Arker, ArkerError, type VM } from '@arker-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arker } from '../index';

const HOLD = ': computesdk-keep-awake; while :; do sleep 3600 || exit; done';

type MockRun = { run_id: string; command: string; state: string };

let nextId = 0;

function mockVm(opts: { session?: () => Promise<unknown>; hold?: () => Promise<unknown>; runs?: MockRun[]; cancel?: () => Promise<unknown> } = {}) {
  const vm = {
    id: `vm-${++nextId}`,
    createSession: vi.fn(opts.session ?? (async () => ({ session_id: 'sess-awake' }))),
    run: vi.fn(async (command: string, _options?: unknown) => {
      if (command !== HOLD) return { stdout: 'ok\n', stderr: '', exitCode: 0 };
      return opts.hold ? opts.hold() : { type: 'background', runId: 'run-awake' };
    }),
    listRuns: vi.fn(async (options?: { state?: string }) => ({ runs: (opts.runs ?? []).filter((r) => r.state === options?.state) })),
    cancelRun: vi.fn(async (_runId: string) => (opts.cancel ? opts.cancel() : { ok: true })),
    deleteSession: vi.fn(async (_sessionId: string) => ({ deleted: true })),
    update: vi.fn(async (_body: unknown) => ({})),
    refresh: vi.fn(async () => ({ state: 'idle' })),
  };
  const fork = vi.spyOn(Arker.prototype, 'fork').mockResolvedValue(vm as unknown as VM);
  return { vm, fork };
}

const holdCalls = (vm: ReturnType<typeof mockVm>['vm']) => vm.run.mock.calls.filter(([command]) => command === HOLD);

describe('Arker keep-awake (mock)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('holds the sandbox awake after its first command, for 5 minutes, in a session of its own', async () => {
    const { vm } = mockVm();
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create();
    // Nothing starts at create, so the first command does not wait on it.
    expect(vm.createSession).not.toHaveBeenCalled();
    expect((await sandbox.runCommand('nohup worker &')).exitCode).toBe(0);
    await sandbox.runCommand('echo again');
    await vi.waitFor(() => expect(holdCalls(vm)).toHaveLength(1));
    expect(vm.run.mock.calls[0][0]).toBe('nohup worker &');
    expect(holdCalls(vm)[0][1]).toEqual({ session_id: 'sess-awake', time_to_background: 0, idempotencyKey: expect.any(String), timeout: 300 });
    expect(vm.createSession).toHaveBeenCalledTimes(1);
    expect(vm.listRuns).not.toHaveBeenCalled();
  });

  it('holds it for what is left of the sandbox timeout, or with no limit at 0', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const timed = mockVm();
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create({ timeout: 90_000 });
    now.mockReturnValue(1_060_500);
    await sandbox.runCommand('true');
    await vi.waitFor(() => expect(holdCalls(timed.vm)).toHaveLength(1));
    expect(holdCalls(timed.vm)[0][1]).toMatchObject({ timeout: 30 });

    const unlimited = mockVm();
    await (await arker({ apiKey: 'ark_test' }).instances.create({ timeout: 0 })).runCommand('true');
    await vi.waitFor(() => expect(holdCalls(unlimited.vm)).toHaveLength(1));
    expect(holdCalls(unlimited.vm)[0][1]).not.toHaveProperty('timeout');

    const expired = mockVm();
    const late = await arker({ apiKey: 'ark_test' }).instances.create({ timeout: 1_000 });
    now.mockReturnValue(1_160_500);
    await late.runCommand('true');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(holdCalls(expired.vm)).toHaveLength(0);
  });

  it('ends the hold a restore inherits at once, then holds it after its first command', async () => {
    const runs = [
      { run_id: 'copied-hold', command: HOLD, state: 'pending' },
      { run_id: 'older-hold', command: ': computesdk-keep-awake; sleep infinity', state: 'running' },
      { run_id: 'old-hold', command: HOLD, state: 'completed' },
      { run_id: 'their-run', command: 'sleep 60', state: 'pending' },
    ];
    const { vm, fork } = mockVm({ runs });
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create({ snapshotId: 'vm-snap' });
    expect(fork.mock.calls[0][0]).toMatchObject({ source_vm_id: 'vm-snap' });
    await vi.waitFor(() => expect(vm.cancelRun).toHaveBeenCalledTimes(2));
    expect(vm.listRuns.mock.calls).toEqual([[{ state: 'pending' }], [{ state: 'running' }]]);
    expect(vm.cancelRun.mock.calls).toEqual([['copied-hold'], ['older-hold']]);
    expect(holdCalls(vm)).toHaveLength(0);
    await sandbox.runCommand('true');
    await vi.waitFor(() => expect(holdCalls(vm)).toHaveLength(1));
  });

  it('waits for the inherited hold to end before starting its own, which uses the same command', async () => {
    let listed!: (value: { runs: MockRun[] }) => void;
    const { vm } = mockVm({ runs: [{ run_id: 'copied-hold', command: HOLD, state: 'pending' }] });
    vm.listRuns.mockImplementationOnce(() => new Promise((resolve) => { listed = resolve; }));
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create({ snapshotId: 'vm-snap' });
    await sandbox.runCommand('true');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(holdCalls(vm)).toHaveLength(0);
    listed({ runs: [{ run_id: 'copied-hold', command: HOLD, state: 'pending' }] });
    await vi.waitFor(() => expect(holdCalls(vm)).toHaveLength(1));
    expect(vm.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(vm.createSession.mock.invocationCallOrder[0]);
  });

  it('tries a cancel again while Arker is briefly unavailable', async () => {
    let refusals = 1;
    const { vm } = mockVm({
      runs: [{ run_id: 'copied-hold', command: HOLD, state: 'pending' }],
      cancel: async () => {
        if (refusals-- > 0) throw new ArkerError('unavailable', 'try again', 503);
        return { ok: true };
      },
    });
    await arker({ apiKey: 'ark_test' }).instances.create({ snapshotId: 'vm-snap' });
    await vi.waitFor(() => expect(vm.cancelRun).toHaveBeenCalledTimes(2), { timeout: 5_000 });
  });

  it('ends a hold inherited from a VM of yours forked by name, but looks for none in a public golden or an image', async () => {
    const { vm, fork } = mockVm({ runs: [{ run_id: 'copied-hold', command: HOLD, state: 'running' }] });
    await arker({ apiKey: 'ark_test' }).instances.create({ templateId: 'my-base' });
    expect(fork.mock.calls[0][0]).toMatchObject({ source_vm_name: 'my-base' });
    await vi.waitFor(() => expect(vm.cancelRun).toHaveBeenCalledWith('copied-hold'));
    vm.listRuns.mockClear();
    await arker({ apiKey: 'ark_test' }).instances.create();
    await arker({ apiKey: 'ark_test' }).instances.create({ templateId: 'ubuntu-coding' });
    await arker({ apiKey: 'ark_test' }).instances.create({ image: 'ubuntu:24.04' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vm.listRuns).not.toHaveBeenCalled();
  });

  it('reports the keep-awake window as the sandbox timeout', async () => {
    mockVm();
    expect((await (await arker({ apiKey: 'ark_test' }).instances.create()).getInfo()).timeout).toBe(300_000);
    mockVm();
    expect((await (await arker({ apiKey: 'ark_test' }).instances.create({ timeout: 90_000 })).getInfo()).timeout).toBe(90_000);
    mockVm();
    expect((await (await arker({ apiKey: 'ark_test', keepAwake: false }).instances.create({ timeout: 90_000 })).getInfo()).timeout).toBe(0);
  });

  it('deletes the session of a hold that failed to start, and gives up after three tries', async () => {
    const { vm } = mockVm({ hold: async () => { throw new ArkerError('unavailable', 'no capacity', 503); } });
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create({ timeout: 0 });
    for (let i = 0; i < 5; i++) {
      await sandbox.runCommand('true');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(holdCalls(vm)).toHaveLength(3);
    expect(vm.deleteSession).toHaveBeenCalledTimes(3);
  });

  it('starts no hold while paused, even when a first command ends after the pause', async () => {
    const { vm } = mockVm();
    let finish!: () => void;
    vm.run.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ stdout: '', stderr: '', exitCode: 0 }); }));
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create();
    const first = sandbox.runCommand('make');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await sandbox.pause!();
    finish();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vm.createSession).not.toHaveBeenCalled();
    await sandbox.resume!();
    await vi.waitFor(() => expect(holdCalls(vm)).toHaveLength(1));
  });

  it('pauses only once the hold has started, so it cannot wake the VM again', async () => {
    let started!: (value: unknown) => void;
    const { vm } = mockVm({ session: () => new Promise((resolve) => { started = resolve; }) });
    const sandbox = await arker({ apiKey: 'ark_test' }).instances.create();
    await sandbox.runCommand('true');
    const paused = sandbox.pause!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vm.update).not.toHaveBeenCalled();
    started({ session_id: 'sess-awake' });
    await paused;
    expect(holdCalls(vm)).toHaveLength(1);
    expect(vm.update.mock.invocationCallOrder[0]).toBeGreaterThan(vm.run.mock.invocationCallOrder.at(-1)!);
  });
});

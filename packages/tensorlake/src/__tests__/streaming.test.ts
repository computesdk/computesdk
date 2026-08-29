import { describe, expect, it, vi } from 'vitest';
import { streamTensorlakeCommand, TIMEOUT_EXIT_CODE, type StreamableTensorlakeSandbox } from '../streaming';

/**
 * A sandbox whose follow streams are driven by the test: each `emit` releases
 * one line to whichever follow is waiting, so a callback firing before the
 * command exits is observable rather than assumed.
 */
function fakeSandbox(overrides: Partial<StreamableTensorlakeSandbox> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exited = false;
  let exitCode: number | undefined;
  const waiters: Array<() => void> = [];

  const release = () => {
    while (waiters.length > 0) waiters.pop()!();
  };

  async function* follow(lines: string[], signal?: AbortSignal): AsyncIterable<{ line: string }> {
    let sent = 0;
    while (true) {
      while (sent < lines.length) {
        yield { line: lines[sent] };
        sent += 1;
      }
      if (exited || signal?.aborted) return;
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  }

  const sandbox: StreamableTensorlakeSandbox = {
    startProcess: vi.fn(async () => ({ pid: 7 })),
    followStdout: (_pid, options) => follow(stdout, options?.signal),
    followStderr: (_pid, options) => follow(stderr, options?.signal),
    getProcess: vi.fn(async () => ({
      status: exited ? 'exited' : 'running',
      exitCode,
    })),
    getStdout: vi.fn(async () => ({ lines: stdout })),
    getStderr: vi.fn(async () => ({ lines: stderr })),
    killProcess: vi.fn(async () => {
      exited = true;
      exitCode = 137;
      release();
    }),
    ...overrides,
  };

  return {
    sandbox,
    emitStdout(line: string) {
      stdout.push(line);
      release();
    },
    emitStderr(line: string) {
      stderr.push(line);
      release();
    },
    exit(code: number) {
      exited = true;
      exitCode = code;
      release();
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('streamTensorlakeCommand', () => {
  it('delivers each line while the command is still running', async () => {
    const seen: string[] = [];
    const fake = fakeSandbox();

    const running = streamTensorlakeCommand(fake.sandbox, 'for i in 1 2; do echo tick $i; done', {
      onStdout: (text) => seen.push(text),
    });

    fake.emitStdout('tick 1');
    await flush();
    expect(seen).toEqual(['tick 1\n']);

    fake.emitStdout('tick 2');
    await flush();
    expect(seen).toEqual(['tick 1\n', 'tick 2\n']);

    fake.exit(0);
    const result = await running;
    expect(result).toMatchObject({ stdout: 'tick 1\ntick 2\n', stderr: '', exitCode: 0 });
    expect(fake.sandbox.startProcess).toHaveBeenCalledWith('sh', expect.objectContaining({
      args: ['-c', 'for i in 1 2; do echo tick $i; done'],
    }));
  });

  it('keeps stderr separate and reports the exit code', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const fake = fakeSandbox();

    const running = streamTensorlakeCommand(fake.sandbox, 'sh -c "echo a; echo b >&2; exit 3"', {
      onStdout: (text) => out.push(text),
      onStderr: (text) => err.push(text),
    });

    fake.emitStdout('a');
    fake.emitStderr('b');
    await flush();
    fake.exit(3);

    const result = await running;
    expect(out).toEqual(['a\n']);
    expect(err).toEqual(['b\n']);
    expect(result.exitCode).toBe(3);
  });

  it('passes the working directory and environment to the process', async () => {
    const fake = fakeSandbox();
    const running = streamTensorlakeCommand(fake.sandbox, 'pwd', {
      cwd: '/tmp/ci',
      env: { CI: 'true' },
      onStdout: () => {},
    });
    fake.exit(0);
    await running;

    expect(fake.sandbox.startProcess).toHaveBeenCalledWith('sh', expect.objectContaining({
      workingDir: '/tmp/ci',
      env: { CI: 'true' },
    }));
  });

  it('backfills output the wire dropped once the process has exited', async () => {
    const seen: string[] = [];
    const fake = fakeSandbox({
      // eslint-disable-next-line require-yield
      followStdout: async function* () {
        throw new Error('connection reset');
      },
      getStdout: async () => ({ lines: ['tick 1', 'tick 2'] }),
    });

    const running = streamTensorlakeCommand(fake.sandbox, 'echo', {
      onStdout: (text) => seen.push(text),
    });
    fake.exit(0);

    const result = await running;
    expect(seen).toEqual(['tick 1\ntick 2\n']);
    expect(result.stdout).toBe('tick 1\ntick 2\n');
  });

  it('kills the process and reports a timeout when one is set', async () => {
    const fake = fakeSandbox();
    const running = streamTensorlakeCommand(fake.sandbox, 'sleep 600', {
      timeout: 5,
      onStdout: () => {},
    });

    const result = await running;
    expect(fake.sandbox.killProcess).toHaveBeenCalledWith(7);
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  it('does not call a finished command timed out while reading its exit status', async () => {
    const fake = fakeSandbox({
      // Reading the exit status outlasts the deadline; the process itself did not.
      getProcess: vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        return { status: 'exited', exitCode: 0 };
      }),
    });

    const running = streamTensorlakeCommand(fake.sandbox, 'echo hi', {
      timeout: 5,
      onStdout: () => {},
    });
    fake.emitStdout('hi');
    fake.exit(0);

    const result = await running;
    expect(result.exitCode).toBe(0);
    expect(fake.sandbox.killProcess).not.toHaveBeenCalled();
  });

  it('returns at the deadline even when the kill request fails', async () => {
    const fake = fakeSandbox({
      killProcess: vi.fn(async () => {
        throw new Error('management API unreachable');
      }),
      getProcess: vi.fn(async () => ({ status: 'running' })),
    });

    // The process never exits and cannot be killed: only abandoning the follow
    // streams gets the caller its deadline back.
    const result = await streamTensorlakeCommand(fake.sandbox, 'sleep 600', {
      timeout: 5,
      onStdout: () => {},
    });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  it('returns at the deadline even when the kill request never answers', async () => {
    const fake = fakeSandbox({
      killProcess: vi.fn(() => new Promise<void>(() => {})),
      getProcess: vi.fn(async () => ({ status: 'running' })),
    });

    const result = await streamTensorlakeCommand(fake.sandbox, 'sleep 600', {
      timeout: 5,
      onStdout: () => {},
    });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  it('keeps the deadline armed when a follow failed and the process is still running', async () => {
    // A dropped follow is not an exit, so the timeout is still the only thing
    // that will stop the command.
    const fake = fakeSandbox({
      // eslint-disable-next-line require-yield
      followStdout: async function* () {
        throw new Error('connection reset');
      },
      getProcess: vi.fn(async () => ({ status: 'running' })),
      getStdout: async () => ({ lines: ['tick 1'] }),
    });

    const result = await streamTensorlakeCommand(fake.sandbox, 'sleep 600', {
      timeout: 30,
      onStdout: () => {},
    });

    expect(fake.sandbox.killProcess).toHaveBeenCalledWith(7);
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  it('reports a process that could not be started', async () => {
    const fake = fakeSandbox({
      startProcess: vi.fn(async () => {
        throw new Error('sandbox is not running');
      }),
    });

    const result = await streamTensorlakeCommand(fake.sandbox, 'echo hi', { onStdout: () => {} });
    expect(result).toMatchObject({ exitCode: 127, stderr: 'sandbox is not running', stdout: '' });
  });
});

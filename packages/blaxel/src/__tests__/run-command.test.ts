import { describe, it, expect, vi } from 'vitest';
import type { SandboxInstance } from '@blaxel/core';
import { daemonSeedScriptCommand } from 'daemond';
import type { SeedInvocationResult } from 'daemond';
import { blaxel, BlaxelExecError } from '../index';
import type { BlaxelCommandResult } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	SandboxInstance: {
		get: vi.fn(),
	},
}));

type ExecOptions = {
	command: string;
	waitForCompletion?: boolean;
	onStdout?: (line: string) => void;
	onStderr?: (line: string) => void;
	onLog?: (line: string) => void;
};

type StreamOptions = {
	onStdout?: (line: string) => void;
	onStderr?: (line: string) => void;
	onLog?: (line: string) => void;
	onError?: (err: Error) => void;
};

function makeSandbox(
	execImpl: (opts: ExecOptions) => Promise<Record<string, unknown>>,
	logsImpl?: (pid: string, type: string) => Promise<string>,
	waitImpl?: (pid: string, opts?: { maxWait?: number; interval?: number }) => Promise<Record<string, unknown>>,
	streamImpl?: (pid: string, opts: StreamOptions) => { close: () => void; wait: () => Promise<void> }
): SandboxInstance {
	return {
		process: {
			exec: vi.fn(execImpl),
			logs: vi.fn(logsImpl ?? (async () => '')),
			wait: vi.fn(waitImpl ?? (async () => ({ status: 'completed' }))),
			kill: vi.fn(async () => ({})),
			streamLogs: vi.fn(
				streamImpl ?? (() => ({ close: () => {}, wait: async () => {} }))
			),
		},
	} as unknown as SandboxInstance;
}

async function getSandbox(sandbox: SandboxInstance, exec: 'native' | 'daemon' = 'native') {
	const { SandboxInstance: MockedInstance } = await import('@blaxel/core');
	vi.mocked(MockedInstance.get).mockResolvedValue(sandbox);
	const sbx = await blaxel({ exec }).sandbox.getById('test-sandbox');
	expect(sbx).not.toBeNull();
	return sbx!;
}

async function runEcho(sandbox: SandboxInstance): Promise<BlaxelCommandResult> {
	return (await getSandbox(sandbox)).runCommand('echo hello') as Promise<BlaxelCommandResult>;
}

describe('blaxel runCommand output capture', () => {
	it('concatenates streamed chunks exactly, without inventing delimiters', async () => {
		const sandbox = makeSandbox(async (opts) => {
			opts.onStdout?.('hello ');
			opts.onStdout?.('world\n');
			opts.onStderr?.('er');
			opts.onStderr?.('ror');
			return { status: 'completed', exitCode: 0, pid: 'p1' };
		});

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('hello world\n');
		expect(result.stderr).toBe('error');
		expect(result.exitCode).toBe(0);
	});

	it('prefers exact result.stdout/stderr fields over streamed chunks', async () => {
		const sandbox = makeSandbox(async (opts) => {
			opts.onStdout?.('chunk1');
			return { status: 'completed', exitCode: 0, pid: 'p1', stdout: 'exact\noutput\n' };
		});

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('exact\noutput\n');
	});

	it('fetches process.logs(pid) when the result has no stdout', async () => {
		const logs = vi.fn(async (_pid: string, type: string) =>
			type === 'stdout' ? 'hello from logs endpoint' : ''
		);
		const sandbox = makeSandbox(
			async () => ({ status: 'completed', exitCode: 0, pid: 'p1', stdout: '', stderr: '' }),
			logs
		);

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('hello from logs endpoint');
		expect(logs).toHaveBeenCalledWith('p1', 'stdout');
	});

	it('still recovers stderr when the stdout logs fetch fails', async () => {
		const logs = vi.fn(async (_pid: string, type: string) => {
			if (type === 'stdout') throw new Error('logs endpoint boom');
			return 'err output';
		});
		const sandbox = makeSandbox(
			async () => ({ status: 'failed', exitCode: 2, pid: 'p1' }),
			logs
		);

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('err output');
		expect(result.exitCode).toBe(2);
	});

	it('uses combined logs as stdout only when stderr is also empty', async () => {
		const sandbox = makeSandbox(async () => ({
			status: 'completed',
			exitCode: 0,
			stdout: '',
			stderr: '',
			logs: 'hello from logs',
		}));

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('hello from logs');
		expect(result.stderr).toBe('');
	});

	it('does not duplicate combined logs into stdout when stderr is present', async () => {
		const sandbox = makeSandbox(async () => ({
			status: 'failed',
			exitCode: 1,
			stdout: '',
			stderr: 'boom',
			logs: 'boom',
		}));

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('boom');
	});

	it('throws BlaxelExecError instead of inventing an exit code when status is failed with exit code 0', async () => {
		const sandbox = makeSandbox(async () => ({
			status: 'failed',
			exitCode: 0,
			pid: 'p1',
			stderr: 'boom',
		}));

		const error = await runEcho(sandbox).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(BlaxelExecError);
		const execError = error as BlaxelExecError;
		expect(execError.status).toBe('failed');
		expect(execError.exitCode).toBe(0);
		expect(execError.stderr).toBe('boom');
		expect(execError.message).toContain('one exec at a time');
	});

	it('throws BlaxelExecError when the exec channel is severed (terminated, no exit code)', async () => {
		const sandbox = makeSandbox(async () => ({ status: 'terminated', pid: 'p1' }));

		const error = await runEcho(sandbox).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(BlaxelExecError);
		expect((error as BlaxelExecError).status).toBe('terminated');
		expect((error as BlaxelExecError).exitCode).toBeNull();
	});

	it('reports status alongside a completed exit code', async () => {
		const sandbox = makeSandbox(async () => ({ status: 'completed', exitCode: 0, pid: 'p1', stdout: 'ok' }));

		const result = await runEcho(sandbox);

		expect(result.status).toBe('completed');
		expect(result.exitCode).toBe(0);
	});

	it('waits for a still-running process and recovers output from the finished process', async () => {
		const wait = vi.fn(async () => ({
			status: 'completed',
			exitCode: 0,
			stdout: 'waited output\n',
			stderr: '',
		}));
		const sandbox = makeSandbox(
			async () => ({ status: 'running', pid: 'p1' }),
			undefined,
			wait
		);

		const result = await runEcho(sandbox);

		expect(wait).toHaveBeenCalledWith('p1', expect.objectContaining({ interval: 500 }));
		expect(result.stdout).toBe('waited output\n');
		expect(result.exitCode).toBe(0);
	});

	it('waits for a still-running process then falls back to logs(pid)', async () => {
		const logs = vi.fn(async (_pid: string, type: string) =>
			type === 'stdout' ? 'recovered after wait' : ''
		);
		const sandbox = makeSandbox(
			async () => ({ status: 'running', pid: 'p1' }),
			logs,
			async () => ({ status: 'completed', exitCode: 0, stdout: '', stderr: '' })
		);

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('recovered after wait');
		expect(logs).toHaveBeenCalledWith('p1', 'stdout');
	});

	it('captures output via the live log stream when the process is still running', async () => {
		const stream = vi.fn((_pid: string, opts: StreamOptions) => {
			opts.onStdout?.('hello');
			opts.onStdout?.('world');
			opts.onStderr?.('warn line');
			return { close: () => {}, wait: async () => {} };
		});
		const sandbox = makeSandbox(
			async () => ({ status: 'running', pid: 'p1' }),
			async () => '',
			async () => ({ status: 'completed', exitCode: 0, stdout: '', stderr: '' }),
			stream
		);

		const result = await runEcho(sandbox);

		expect(stream).toHaveBeenCalledWith('p1', expect.any(Object));
		// streamLogs strips protocol line delimiters; they are restored on join
		expect(result.stdout).toBe('hello\nworld\n');
		expect(result.stderr).toBe('warn line\n');
	});

	it('does not wait when exec already returns a terminal status', async () => {
		const wait = vi.fn(async () => ({ status: 'completed' }));
		const sandbox = makeSandbox(
			async () => ({ status: 'completed', exitCode: 0, stdout: 'done', pid: 'p1' }),
			undefined,
			wait
		);

		const result = await runEcho(sandbox);

		expect(wait).not.toHaveBeenCalled();
		expect(result.stdout).toBe('done');
	});

	it('fails cleanly and kills the process when the wait times out', async () => {
		const kill = vi.fn(async () => ({}));
		const sandbox = makeSandbox(
			async () => ({ status: 'running', pid: 'p1' }),
			undefined,
			async () => { throw new Error('Process did not finish in time'); }
		);
		(sandbox.process as unknown as { kill: typeof kill }).kill = kill;

		const result = await runEcho(sandbox);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain('Process did not finish in time');
		expect(kill).toHaveBeenCalledWith('p1');
	});

	it('fails when wait resolves without a terminal status (swallowed poll error)', async () => {
		const kill = vi.fn(async () => ({}));
		const sandbox = makeSandbox(
			async () => ({ status: 'running', pid: 'p1' }),
			undefined,
			async () => ({ status: 'running' }) // SDK wait() returns stale data on poll errors
		);
		(sandbox.process as unknown as { kill: typeof kill }).kill = kill;

		const result = await runEcho(sandbox);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain('did not reach a terminal state');
		expect(kill).toHaveBeenCalledWith('p1');
	});

	it('surfaces real non-zero exit codes unchanged', async () => {
		const sandbox = makeSandbox(async (opts) => {
			opts.onStderr?.('bad');
			return { status: 'failed', exitCode: 3, pid: 'p1' };
		});

		const result = await runEcho(sandbox);

		expect(result.exitCode).toBe(3);
		expect(result.stderr).toBe('bad');
		expect(result.status).toBe('failed');
	});
});

function seedOutput(command: Partial<SeedInvocationResult['command']>): string {
	const invocation: SeedInvocationResult = {
		token: 't',
		requestId: 'r',
		daemon: { reused: true, pid: 1, sseUrl: 'http://127.0.0.1:38989/events?token=t' },
		command: { exitCode: 0, signal: null, stdout: '', stderr: '', combined: '', ...command },
	};
	return `${JSON.stringify(invocation)}\n`;
}

function decodeLauncherPayload(launcher: string): Record<string, unknown> {
	const words = launcher.split(' ');
	return JSON.parse(Buffer.from(words[words.length - 1], 'base64').toString('utf8'));
}

describe('blaxel runCommand via daemond (default exec mode)', () => {
	it('delivers the command as a base64 launcher and returns the real exit code', async () => {
		const exec = vi.fn(async (opts: ExecOptions) => {
			const payload = decodeLauncherPayload(opts.command);
			expect(payload).toMatchObject({ command: 'sh', args: ['-c', 'echo "a  b" $X'], cwd: '/tmp', env: { X: '1' }, detach: false });
			return { status: 'completed', exitCode: 0, pid: 'p1', stdout: seedOutput({ exitCode: 5, stdout: 'out\n', stderr: 'err' }) };
		});
		const sandbox = makeSandbox(exec);

		const result = await (await getSandbox(sandbox, 'daemon')).runCommand('echo "a  b" $X', { cwd: '/tmp', env: { X: '1' } });

		expect(exec).toHaveBeenCalledTimes(1);
		const launcher = exec.mock.calls[0][0].command;
		expect(launcher).toBe(daemonSeedScriptCommand({ ssePort: 38989 }, decodeLauncherPayload(launcher) as { command: string }, { argvEncoding: 'base64' }));
		expect(launcher).toMatch(/^printf %s [A-Za-z0-9+/=]+ \| base64 -d \| sh -s [A-Za-z0-9+/=]+ [A-Za-z0-9+/=]+$/);
		expect(result).toMatchObject({ exitCode: 5, stdout: 'out\n', stderr: 'err', status: 'completed', signal: null });
	});

	it('runs background commands as detached daemon jobs and reports status running', async () => {
		const exec = vi.fn(async (opts: ExecOptions) => {
			expect(decodeLauncherPayload(opts.command)).toMatchObject({ detach: true });
			return { status: 'completed', exitCode: 0, pid: 'p1', stdout: seedOutput({ status: 'running', exitCode: null, jobId: 'job-1', pid: 42 }) };
		});

		const result = await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('sleep 60', { background: true });

		expect(result).toMatchObject({ status: 'running', exitCode: 0, jobId: 'job-1' });
	});

	it('maps a signal-terminated job to 128+signo with status killed', async () => {
		const exec = vi.fn(async () => ({
			status: 'completed', exitCode: 0, pid: 'p1',
			stdout: seedOutput({ status: 'exited', exitCode: null, signal: 'SIGKILL' }),
		}));

		const result = await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('true');

		expect(result).toMatchObject({ status: 'killed', exitCode: 137, signal: 'SIGKILL' });
	});

	it('falls back to native exec for the sandbox when the launcher cannot bootstrap', async () => {
		const exec = vi.fn(async (opts: ExecOptions) => {
			if (opts.command.startsWith('printf %s ')) {
				return { status: 'failed', exitCode: 127, pid: 'p1', stderr: 'daemon bootstrap failed: no node' };
			}
			return { status: 'completed', exitCode: 0, pid: 'p2', stdout: 'native\n' };
		});
		const sbx = await getSandbox(makeSandbox(exec), 'daemon');

		const first = await sbx.runCommand('echo native');
		const second = await sbx.runCommand('echo native');

		expect(first).toMatchObject({ stdout: 'native\n', exitCode: 0, status: 'completed' });
		expect(second.stdout).toBe('native\n');
		// launcher, native, native: the downgrade sticks for this sandbox
		expect(exec.mock.calls.map((c) => c[0].command.startsWith('printf %s '))).toEqual([true, false, false]);
	});

	it('does not downgrade to native on a transient launcher failure (non-127)', async () => {
		const exec = vi.fn(async (opts: ExecOptions) => {
			if (opts.command.startsWith('printf %s ')) {
				return { status: 'failed', exitCode: 1, pid: 'p1', stderr: 'daemon: connect ECONNREFUSED' };
			}
			return { status: 'completed', exitCode: 0, pid: 'p2', stdout: 'native\n' };
		});
		const sbx = await getSandbox(makeSandbox(exec), 'daemon');

		const error = await sbx.runCommand('echo x').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(BlaxelExecError);
		expect((error as BlaxelExecError).stderr).toContain('ECONNREFUSED');

		await sbx.runCommand('echo x').catch(() => undefined);
		expect(exec.mock.calls.map((c) => c[0].command.startsWith('printf %s '))).toEqual([true, true]);
	});

	it('applies the 5-minute default deadline to the daemon payload when no timeout is given', async () => {
		const exec = vi.fn(async (opts: ExecOptions) => {
			expect(decodeLauncherPayload(opts.command)).toMatchObject({ timeoutMs: 5 * 60 * 1000 });
			return { status: 'completed', exitCode: 0, pid: 'p1', stdout: seedOutput({}) };
		});

		await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('true');
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it('gives background jobs no default deadline', async () => {
		const exec = vi.fn(async (opts: ExecOptions) => {
			const payload = decodeLauncherPayload(opts.command);
			expect(payload).toMatchObject({ detach: true });
			expect(payload).not.toHaveProperty('timeoutMs');
			return {
				status: 'completed', exitCode: 0, pid: 'p1',
				stdout: seedOutput({ status: 'running', exitCode: null, jobId: 'job-1' }),
			};
		});

		await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('sleep 1d', { background: true });
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it('maps every Linux signal, including SIGUSR1, to 128+signo', async () => {
		const exec = vi.fn(async () => ({
			status: 'completed', exitCode: 0, pid: 'p1',
			stdout: seedOutput({ status: 'exited', exitCode: null, signal: 'SIGUSR1' }),
		}));

		const result = await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('true');
		expect(result).toMatchObject({ status: 'killed', exitCode: 138, signal: 'SIGUSR1' });
	});

	it('throws instead of guessing an exit code for an unknown signal name', async () => {
		const exec = vi.fn(async () => ({
			status: 'completed', exitCode: 0, pid: 'p1',
			stdout: seedOutput({ status: 'exited', exitCode: null, signal: 'SIGWHATEVER', stdout: 'partial' }),
		}));

		const error = await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('true').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(BlaxelExecError);
		expect((error as BlaxelExecError).exitCode).toBeNull();
		expect((error as BlaxelExecError).stdout).toBe('partial');
	});

	it('surfaces a busy exec slot as BlaxelExecError even in daemon mode', async () => {
		const exec = vi.fn(async () => ({ status: 'failed', exitCode: 0, pid: 'p1' }));

		const error = await (await getSandbox(makeSandbox(exec), 'daemon')).runCommand('true').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(BlaxelExecError);
		expect(exec).toHaveBeenCalledTimes(1);
	});
});

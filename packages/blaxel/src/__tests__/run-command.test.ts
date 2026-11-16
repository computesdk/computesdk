import { describe, it, expect, vi } from 'vitest';
import type { SandboxInstance } from '@blaxel/core';
import { blaxel } from '../index';

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

async function runEcho(sandbox: SandboxInstance) {
	const { SandboxInstance: MockedInstance } = await import('@blaxel/core');
	vi.mocked(MockedInstance.get).mockResolvedValue(sandbox);
	const sbx = await blaxel({}).sandbox.getById('test-sandbox');
	expect(sbx).not.toBeNull();
	return sbx!.runCommand('echo hello');
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

	it('returns nonzero exit code when the API reports status failed', async () => {
		const sandbox = makeSandbox(async () => ({
			status: 'failed',
			exitCode: 0,
			pid: 'p1',
			stderr: 'boom',
		}));

		const result = await runEcho(sandbox);

		expect(result.exitCode).not.toBe(0);
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
	});
});

describe('blaxel runCommand request shape', () => {
	async function connect(sandbox: SandboxInstance) {
		const { SandboxInstance: MockedInstance } = await import('@blaxel/core');
		vi.mocked(MockedInstance.get).mockResolvedValue(sandbox);
		const sbx = await blaxel({}).sandbox.getById('test-sandbox');
		expect(sbx).not.toBeNull();
		return sbx!;
	}

	it('passes env and cwd as native process fields, leaving the command untouched', async () => {
		const sandbox = makeSandbox(async () => ({ status: 'completed', exitCode: 0, pid: 'p1', stdout: 'ok\n' }));
		const sbx = await connect(sandbox);

		await sbx.runCommand('echo "$A" && pwd', { env: { A: 'x y' }, cwd: '/tmp' });

		const request = vi.mocked(sandbox.process.exec).mock.calls[0][0] as Record<string, unknown>;
		expect(request.command).toBe('echo "$A" && pwd');
		expect(request.env).toEqual({ A: 'x y' });
		expect(request.workingDir).toBe('/tmp');
	});

	it('starts background commands without waiting for completion', async () => {
		const sandbox = makeSandbox(async () => ({ status: 'running', pid: 'p1' }));
		const sbx = await connect(sandbox);

		const result = await sbx.runCommand('sleep 5', { background: true });

		const request = vi.mocked(sandbox.process.exec).mock.calls[0][0] as Record<string, unknown>;
		expect(request).toMatchObject({ command: 'sleep 5', waitForCompletion: false });
		expect(result.exitCode).toBe(0);
		expect(sandbox.process.wait).not.toHaveBeenCalled();
	});

	it('streams exec chunks to the caller callbacks', async () => {
		const sandbox = makeSandbox(async (opts) => {
			opts.onStdout?.('a');
			opts.onStderr?.('b');
			return { status: 'completed', exitCode: 0, pid: 'p1' };
		});
		const sbx = await connect(sandbox);
		const out: string[] = [];
		const err: string[] = [];

		const result = await sbx.runCommand('x', { onStdout: (c) => out.push(c), onStderr: (c) => err.push(c) });

		expect(sbx.processRuntime?.streaming).toBe('native');
		expect(out).toEqual(['a']);
		expect(err).toEqual(['b']);
		expect(result.stdout).toBe('a');
	});

	it('streams live log lines when exec returns a still-running process', async () => {
		const sandbox = makeSandbox(
			async () => ({ status: 'running', pid: 'p1' }),
			undefined,
			async () => ({ status: 'completed', exitCode: 0 }),
			(_pid, opts) => {
				opts.onStdout?.('line1');
				opts.onStdout?.('line2');
				return { close: () => {}, wait: async () => {} };
			}
		);
		const sbx = await connect(sandbox);
		const out: string[] = [];

		const result = await sbx.runCommand('x', { onStdout: (c) => out.push(c) });

		expect(out).toEqual(['line1\n', 'line2\n']);
		expect(result.stdout).toBe('line1\nline2\n');
	});
});

describe('blaxel runCommand deadline', () => {
	it('kills the named process and fails when exec outruns the timeout', async () => {
		const sandbox = makeSandbox(() => new Promise(() => {}));
		const { SandboxInstance: MockedInstance } = await import('@blaxel/core');
		vi.mocked(MockedInstance.get).mockResolvedValue(sandbox);
		const sbx = (await blaxel({}).sandbox.getById('test-sandbox'))!;

		const result = await sbx.runCommand('sleep 60', { timeout: 50, onStdout: () => {} });

		const request = vi.mocked(sandbox.process.exec).mock.calls[0][0] as Record<string, unknown>;
		expect(request.timeout).toBe(1);
		expect(sandbox.process.kill).toHaveBeenCalledWith(request.name);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain('timed out');
	});
});

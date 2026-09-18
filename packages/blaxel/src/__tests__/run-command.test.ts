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

function makeSandbox(
	execImpl: (opts: ExecOptions) => Promise<Record<string, unknown>>,
	logsImpl?: (pid: string, type: string) => Promise<string>
): SandboxInstance {
	return {
		process: {
			exec: vi.fn(execImpl),
			logs: vi.fn(logsImpl ?? (async () => '')),
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

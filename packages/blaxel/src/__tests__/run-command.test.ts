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
	it('accumulates stdout/stderr when exec routes through the streaming path', async () => {
		const sandbox = makeSandbox(async (opts) => {
			opts.onStdout?.('hello');
			opts.onStdout?.('world');
			opts.onStderr?.('oops');
			return { status: 'completed', exitCode: 0, pid: 'p1' };
		});

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('hello\nworld');
		expect(result.stderr).toBe('oops');
		expect(result.exitCode).toBe(0);
	});

	it('uses the logs field when the exec response has no stdout', async () => {
		const sandbox = makeSandbox(async () => ({
			status: 'completed',
			exitCode: 0,
			pid: 'p1',
			stdout: '',
			stderr: '',
			logs: 'hello from logs',
		}));

		const result = await runEcho(sandbox);

		expect(result.stdout).toBe('hello from logs');
		expect(result.exitCode).toBe(0);
	});

	it('fetches process.logs(pid) when the result has neither stdout nor logs', async () => {
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

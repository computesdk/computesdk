import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SandboxInstance } from '@blaxel/core';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	getSandbox: vi.fn(),
	SandboxInstance: {
		get: vi.fn(),
		delete: vi.fn(),
		createIfNotExists: vi.fn(),
	},
	Snapshot: { get: vi.fn(), create: vi.fn(), list: vi.fn(), delete: vi.fn() },
}));

async function mockedCore() {
	return await import('@blaxel/core');
}

function makeSandbox(name: string | undefined): SandboxInstance {
	return {
		metadata: { name },
		spec: { runtime: { image: 'blaxel/base-image:latest' } },
		status: 'DEPLOYED',
		fs: { ls: vi.fn(async () => ({ files: [], subdirectories: [] })) },
		system: {
			url: `https://${name ?? 'unnamed'}.example`,
			client: { post: vi.fn(async () => ({ data: { message: 'Standby requested' }, response: { status: 202 } })) },
		},
	} as unknown as SandboxInstance;
}

const LAST_REQUEST = '2026-01-01T00:00:10.000Z';
const STANDBY_AT = '2026-01-01T00:00:25.000Z';

beforeEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('blaxel pause and resume', () => {
	it('declares pause with memory kept', () => {
		expect(blaxel({}).sandbox.pause).toEqual({ memory: true });
	});

	it('pause waits for a standby newer than the last activity; resume wakes the sandbox', async () => {
		const core = await mockedCore();
		const box = makeSandbox('box-1');
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(box);
		vi.mocked(core.getSandbox)
			.mockResolvedValueOnce({ data: { state: 'RUNNING', lastUsedAt: LAST_REQUEST } } as never)
			.mockResolvedValueOnce({ data: { state: 'RUNNING', lastUsedAt: LAST_REQUEST } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: STANDBY_AT } } as never);

		const instance = await blaxel({}).sandbox.create();
		expect(typeof instance.pause).toBe('function');
		await instance.pause!();
		expect(core.getSandbox).toHaveBeenCalledTimes(3);
		expect(core.getSandbox).toHaveBeenCalledWith({ path: { sandboxName: 'box-1' } });
		// It asks for the standby once, after reading the baseline.
		expect(box.system.client.post).toHaveBeenCalledTimes(1);
		expect(box.system.client.post).toHaveBeenCalledWith({ baseUrl: 'https://box-1.example', url: '/standby' });
		expect(vi.mocked(core.getSandbox).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(box.system.client.post).mock.invocationCallOrder[0],
		);

		await instance.resume!();
		expect(box.fs.ls).toHaveBeenCalledWith('/');
		expect(instance.sandboxId).toBe('box-1');
	});

	it('pause ignores a STANDBY whose lastUsedAt has not moved since the call', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(makeSandbox('box-3'));
		vi.mocked(core.getSandbox)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: LAST_REQUEST } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: LAST_REQUEST } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: STANDBY_AT } } as never);

		const instance = await blaxel({}).sandbox.create();
		await instance.pause!();
		expect(core.getSandbox).toHaveBeenCalledTimes(3);
	});

	it('pause needs a standby with a timestamp when the first read had none', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(makeSandbox('box-4'));
		vi.mocked(core.getSandbox)
			.mockResolvedValueOnce({ data: { status: 'DEPLOYED' } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY' } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: STANDBY_AT } } as never);

		const instance = await blaxel({}).sandbox.create();
		await instance.pause!();
		// A STANDBY without lastUsedAt is not enough: it waits for the timestamp.
		expect(core.getSandbox).toHaveBeenCalledTimes(3);
	});

	it('pause leaves the config gate between polls, so another config is not held up', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists)
			.mockResolvedValueOnce(makeSandbox('box-a'))
			.mockResolvedValueOnce(makeSandbox('box-b'));
		const order: string[] = [];
		let polls = 0;
		vi.mocked(core.getSandbox).mockImplementation((async () => {
			polls++;
			return polls >= 3
				? { data: { state: 'STANDBY', lastUsedAt: STANDBY_AT } }
				: { data: { state: 'RUNNING', lastUsedAt: LAST_REQUEST } };
		}) as never);

		const a = await blaxel({ apiKey: 'key-a', workspace: 'ws-a' }).sandbox.create();
		const paused = a.pause!().then(() => order.push('pause done'));
		// Let the first poll finish so pause is in its sleep between polls.
		await vi.waitFor(() => expect(polls).toBe(1));
		await blaxel({ apiKey: 'key-b', workspace: 'ws-b' }).sandbox.create();
		order.push('other config done');
		await paused;

		expect(order).toEqual(['other config done', 'pause done']);
		expect(core.initialize).toHaveBeenCalledWith({ apikey: 'key-b', workspace: 'ws-b' });
		// Each poll re-installs the paused sandbox's own config.
		expect(vi.mocked(core.initialize).mock.calls.at(-1)?.[0]).toEqual({ apikey: 'key-a', workspace: 'ws-a' });
	});

	it('pause still waits for the standby when the standby call fails or is refused', async () => {
		const core = await mockedCore();
		const throwing = makeSandbox('box-6');
		vi.mocked(throwing.system.client.post).mockRejectedValue(new Error('socket hang up'));
		const refused = makeSandbox('box-7');
		vi.mocked(refused.system.client.post).mockResolvedValue({ error: { error: 'not supported' }, response: { status: 501 } } as never);
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValueOnce(throwing).mockResolvedValueOnce(refused);
		vi.mocked(core.getSandbox)
			.mockResolvedValueOnce({ data: { state: 'RUNNING', lastUsedAt: LAST_REQUEST } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: STANDBY_AT } } as never)
			.mockResolvedValueOnce({ data: { state: 'RUNNING', lastUsedAt: LAST_REQUEST } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY', lastUsedAt: STANDBY_AT } } as never);

		for (const box of [throwing, refused]) {
			const instance = await blaxel({}).sandbox.create();
			await instance.pause!();
			expect(box.system.client.post).toHaveBeenCalledTimes(1);
		}
		expect(core.getSandbox).toHaveBeenCalledTimes(4);
	});

	it('pause fails on a control plane error', async () => {
		const core = await mockedCore();
		const box = makeSandbox('box-2');
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(box);
		vi.mocked(core.getSandbox).mockResolvedValue({ error: { message: 'not found' } } as never);
		const instance = await blaxel({}).sandbox.create();
		await expect(instance.pause!()).rejects.toThrow(/Failed to pause Blaxel sandbox box-2/);
		// No standby is asked for a sandbox the control plane cannot read.
		expect(box.system.client.post).not.toHaveBeenCalled();
	});

	it('pause fails at once for a sandbox without a name', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(makeSandbox(undefined));
		const instance = await blaxel({}).sandbox.create();
		await expect(instance.pause!()).rejects.toThrow(/has no name/);
		expect(core.getSandbox).not.toHaveBeenCalled();
	});

	it('pause gives up after 60 s without a standby', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(makeSandbox('box-5'));
		vi.mocked(core.getSandbox).mockResolvedValue({ data: { state: 'RUNNING', lastUsedAt: LAST_REQUEST } } as never);
		const instance = await blaxel({}).sandbox.create();
		vi.useFakeTimers();
		const outcome = expect(instance.pause!()).rejects.toThrow(/did not reach standby within 60 s \(state RUNNING\)/);
		await vi.advanceTimersByTimeAsync(61_000);
		await outcome;
	});
});

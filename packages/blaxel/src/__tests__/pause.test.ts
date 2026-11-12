import { describe, it, expect, vi, beforeEach } from 'vitest';
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

function makeSandbox(name: string): SandboxInstance {
	return {
		metadata: { name },
		spec: { runtime: { image: 'blaxel/base-image:latest' } },
		status: 'DEPLOYED',
		fs: { ls: vi.fn(async () => ({ files: [], subdirectories: [] })) },
	} as unknown as SandboxInstance;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe('blaxel pause and resume', () => {
	it('declares pause with memory kept', () => {
		expect(blaxel({}).sandbox.pause).toEqual({ memory: true });
	});

	it('pause waits until the control plane reports standby; resume wakes the sandbox', async () => {
		const core = await mockedCore();
		const box = makeSandbox('box-1');
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(box);
		vi.mocked(core.getSandbox)
			.mockResolvedValueOnce({ data: { state: 'RUNNING' } } as never)
			.mockResolvedValueOnce({ data: { state: 'STANDBY' } } as never);

		const instance = await blaxel({}).sandbox.create();
		expect(typeof instance.pause).toBe('function');
		await instance.pause!();
		expect(core.getSandbox).toHaveBeenCalledTimes(2);
		expect(core.getSandbox).toHaveBeenCalledWith({ path: { sandboxName: 'box-1' } });

		await instance.resume!();
		expect(box.fs.ls).toHaveBeenCalledWith('/');
		expect(instance.sandboxId).toBe('box-1');
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
			return { data: { state: polls >= 3 ? 'STANDBY' : 'RUNNING' } };
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

	it('pause fails on a control plane error', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(makeSandbox('box-2'));
		vi.mocked(core.getSandbox).mockResolvedValue({ error: { message: 'not found' } } as never);
		const instance = await blaxel({}).sandbox.create();
		await expect(instance.pause!()).rejects.toThrow(/Failed to pause Blaxel sandbox box-2/);
	});
});

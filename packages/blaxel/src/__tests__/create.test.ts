import { describe, it, expect, vi, beforeEach } from 'vitest';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	SandboxInstance: {
		createIfNotExists: vi.fn(async () => ({ metadata: { name: 'sbx-1' } })),
		get: vi.fn(),
	},
}));

async function createCalls() {
	const { SandboxInstance } = await import('@blaxel/core');
	return vi.mocked(SandboxInstance.createIfNotExists).mock.calls;
}

describe('blaxel sandbox.create volumes', () => {
	beforeEach(async () => {
		const { SandboxInstance } = await import('@blaxel/core');
		vi.mocked(SandboxInstance.createIfNotExists).mockClear();
	});

	it('passes typed volumes through to the Blaxel create spec', async () => {
		const provider = blaxel({ region: 'us-pdx-1' });
		await provider.sandbox.create({
			volumes: [{ type: 'ephemeral', name: 'docker', mountPath: '/var/lib/docker', sizeMb: 4096 }],
		});

		const [[spec]] = await createCalls();
		expect(spec).toMatchObject({
			region: 'us-pdx-1',
			volumes: [{ type: 'ephemeral', name: 'docker', mountPath: '/var/lib/docker', sizeMb: 4096 }],
		});
	});

	it('merges provider-level default volumes with per-create volumes', async () => {
		const provider = blaxel({
			volumes: [{ type: 'persistent', name: 'cache', mountPath: '/cache', readOnly: true }],
		});
		await provider.sandbox.create({
			volumes: [{ type: 'ephemeral', name: 'scratch', mountPath: '/scratch', sizeMb: 512 }],
		});

		const [[spec]] = await createCalls();
		expect((spec as { volumes: unknown[] }).volumes).toEqual([
			{ type: 'persistent', name: 'cache', mountPath: '/cache', readOnly: true },
			{ type: 'ephemeral', name: 'scratch', mountPath: '/scratch', sizeMb: 512 },
		]);
	});

	it('omits volumes from the spec when none are configured', async () => {
		await blaxel({}).sandbox.create({});

		const [[spec]] = await createCalls();
		expect(spec).not.toHaveProperty('volumes');
	});
});

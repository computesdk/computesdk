/**
 * Blaxel create with a volume that is already mounted elsewhere (mock-only).
 *
 * Blaxel answers VOLUME_ALREADY_ATTACHED at once. The factory retries that
 * error for its volume settle window (180 s), which only helps while the
 * holder is being deleted: a holder that keeps running keeps the volume.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxInstance } from '@blaxel/core';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	settings: {},
	SandboxInstance: { get: vi.fn(), delete: vi.fn(), createIfNotExists: vi.fn() },
	Snapshot: { get: vi.fn(), create: vi.fn(), list: vi.fn(), delete: vi.fn() },
}));

const attached = { code: 'VOLUME_ALREADY_ATTACHED', message: 'Volume already attached to sandbox:holder-1', status_code: 400 };
const created = { metadata: { name: 'sbx-2' }, spec: { runtime: { image: 'blaxel/base-image:latest' } } } as unknown as SandboxInstance;
const volumes = [{ volume: 'vol-1', mountPath: '/data' }];

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Blaxel create with an already-attached volume (mock-only)', () => {
	it('fails at once when the volume is mounted on a running sandbox', async () => {
		vi.mocked(SandboxInstance.createIfNotExists).mockRejectedValue(attached);
		vi.mocked(SandboxInstance.get).mockResolvedValue({ status: 'DEPLOYED' } as unknown as SandboxInstance);

		const started = Date.now();
		const err = await blaxel({}).instances.create({ volumes } as never).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toMatch(/VOLUME_ALREADY_ATTACHED[\s\S]*holder-1 still holds the volume/);
		expect(err).toMatchObject({ volumeHeld: true });
		expect(SandboxInstance.createIfNotExists).toHaveBeenCalledTimes(1);
		expect(SandboxInstance.get).toHaveBeenCalledWith('holder-1');
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it('keeps retrying while the holder is being deleted, then mounts the volume', async () => {
		vi.mocked(SandboxInstance.createIfNotExists).mockRejectedValueOnce(attached).mockResolvedValueOnce(created);
		vi.mocked(SandboxInstance.get).mockResolvedValue({ status: 'DELETING' } as unknown as SandboxInstance);

		const result = await blaxel({}).instances.create({ volumes } as never);

		expect(result.instanceId).toBe('sbx-2');
		expect(SandboxInstance.createIfNotExists).toHaveBeenCalledTimes(2);
	}, 15_000);

	it('keeps retrying when the holder cannot be read', async () => {
		vi.mocked(SandboxInstance.createIfNotExists).mockRejectedValueOnce(attached).mockResolvedValueOnce(created);
		vi.mocked(SandboxInstance.get).mockRejectedValue(new Error('Sandbox holder-1 not found'));

		const result = await blaxel({}).instances.create({ volumes } as never);

		expect(result.instanceId).toBe('sbx-2');
		expect(SandboxInstance.createIfNotExists).toHaveBeenCalledTimes(2);
	}, 15_000);
});

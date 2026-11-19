/**
 * Blaxel standard sizes (mock-only; no sandbox is booted).
 *
 * Blaxel sizes a sandbox by `memory` (MB) only; the API reference and the
 * @blaxel/core `SandboxRuntime.memory` type allocate CPU cores = memory / 2048.
 * The Sandboxes overview and troubleshooting pages instead say 16 GB gets
 * 6 cores, so shapes from 16 GB up are not verified.
 *
 * Ways this mapping could fail, each covered below:
 * - wrong shape: a class sends memory that does not give its vCPU/RAM
 *   (xs and sm 2048, md 4096, lg 8192), or `resolved` misstates the shape;
 * - below-profile boot: xs mapped to 1024 MB (0.5 core), or xl+ mapped to
 *   16 GB+ where the docs disagree on the core count (6 vs 8);
 * - silent default boot: sizeClass dropped so the SDK default 4096 MB or the
 *   configured `memory` wins, or an unmapped class creates anyway;
 * - dropped field: `memory` lost on a templateId/image create, or a
 *   snapshot fork/sandbox attach that cannot take memory accepted;
 * - conflict accepted: sizeClass combined with native `memory`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxInstance, Snapshot } from '@blaxel/core';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	settings: {},
	SandboxInstance: { get: vi.fn(), delete: vi.fn(), createIfNotExists: vi.fn() },
	Snapshot: { get: vi.fn(), create: vi.fn(), list: vi.fn(), delete: vi.fn() },
}));

const core = { SandboxInstance, Snapshot };
const sandbox = { metadata: { name: 'sbx-1' }, spec: { runtime: { image: 'blaxel/base-image:latest' } } } as unknown as SandboxInstance;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(core.SandboxInstance.createIfNotExists).mockResolvedValue(sandbox);
});

const mapped = [['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192]] as const;

describe('Blaxel standard size mapping (mock-only)', () => {
	it('lists xs, sm, md and lg; xl, 2xl and 3xl unknown', () => {
		const list = blaxel({}).sizes.list();
		expect(Object.fromEntries(list.map(r => [r.requested.sizeClass, r.status]))).toEqual({
			xs: 'supported', sm: 'supported', md: 'supported', lg: 'supported',
			xl: 'unknown', '2xl': 'unknown', '3xl': 'unknown',
		});
		for (const r of list) if (r.status !== 'supported') expect(r.reason).toMatch(/\S/);
		expect(blaxel({}).sizes.resolve('xl')).toMatchObject({ reason: expect.stringMatching(/6 cores/) });
	});

	it.each(mapped)('resolves %s to exactly its profile via memory', (sizeClass, vcpus, memoryMiB) => {
		expect(blaxel({}).sizes.resolve(sizeClass)).toMatchObject({
			status: 'supported', nativeOptions: { memory: memoryMiB }, resolved: { vcpus, memoryMiB },
		});
	});

	it('resolves xs to the first 1-core shape, 2048 MB, not 1024 MB (0.5 core)', async () => {
		expect(blaxel({}).sizes.resolve('xs')).toMatchObject({
			status: 'supported', nativeOptions: { memory: 2048 }, resolved: { vcpus: 1, memoryMiB: 2048 },
		});
		const result = await blaxel({}).instances.create({ sizeClass: 'xs' });
		expect(vi.mocked(core.SandboxInstance.createIfNotExists).mock.calls[0][0]).toMatchObject({ memory: 2048 });
		expect(result.sizing).toMatchObject({ requested: { sizeClass: 'xs', vcpus: 1, memoryMiB: 1024 }, resolved: { vcpus: 1, memoryMiB: 2048 } });
	});

	it.each(mapped)('creates %s with its memory, overriding the configured default', async (sizeClass, vcpus, memoryMiB) => {
		const result = await blaxel({ memory: 16384 }).instances.create({ sizeClass });
		const spec = vi.mocked(core.SandboxInstance.createIfNotExists).mock.calls[0][0] as Record<string, unknown>;
		expect(spec.memory).toBe(memoryMiB);
		expect(spec).not.toHaveProperty('sizeClass');
		expect(result.sizing).toMatchObject({ requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared' });
	});

	it.each([{ templateId: 'sandbox/my-tpl:abc' }, { image: 'ubuntu:24.04' }])('keeps memory on an image/template create: %j', async (extra) => {
		await blaxel({}).instances.create({ sizeClass: 'md', ...extra });
		expect(core.SandboxInstance.createIfNotExists).toHaveBeenCalledWith(expect.objectContaining({ memory: 4096 }));
	});

	it.each([
		{ sizeClass: 'xl' }, { sizeClass: '2xl' }, { sizeClass: '3xl' },
		{ sizeClass: 'sm', memory: 2048 }, { sizeClass: 'sm', snapshotId: 'snap_1' }, { sizeClass: 'sm', sandboxId: 'sbx-0' },
	])('rejects without creating: %j', async (options) => {
		await expect(blaxel({}).instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', fallback: false });
		expect(core.SandboxInstance.createIfNotExists).not.toHaveBeenCalled();
		expect(core.Snapshot.get).not.toHaveBeenCalled();
		expect(core.SandboxInstance.get).not.toHaveBeenCalled();
	});

	it('rejects snapshot and attach paths with unsupported', () => {
		expect(blaxel({}).sizes.resolve('sm', { snapshotId: 'snap_1' }).status).toBe('unsupported');
		expect(blaxel({}).sizes.resolve('sm', { sandboxId: 'sbx-0' }).status).toBe('unsupported');
	});

	it('rejects native memory as a conflict', () => {
		expect(() => blaxel({}).sizes.resolve('sm', { memory: 2048 } as any)).toThrow(expect.objectContaining({ code: 'conflict' }));
	});

	it('leaves creates without sizeClass on their native memory', async () => {
		await blaxel({ memory: 8192 }).instances.create({});
		expect(core.SandboxInstance.createIfNotExists).toHaveBeenCalledWith(expect.objectContaining({ memory: 8192 }));
	});
});

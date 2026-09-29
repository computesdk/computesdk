import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SandboxInstance, Snapshot } from '@blaxel/core';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	SandboxInstance: {
		get: vi.fn(),
		delete: vi.fn(),
		createIfNotExists: vi.fn(),
	},
	Snapshot: {
		get: vi.fn(),
		create: vi.fn(),
		list: vi.fn(),
		delete: vi.fn(),
	},
}));

async function mockedCore() {
	return await import('@blaxel/core');
}

function makeSandbox(name: string): SandboxInstance {
	return {
		metadata: { name },
		spec: { runtime: { image: 'blaxel/base-image:latest' } },
		status: 'deployed',
	} as unknown as SandboxInstance;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		id: 'snap_123',
		name: 'my-snapshot',
		status: 'ready',
		createdAt: '2026-01-01T00:00:00Z',
		source: { kind: 'sandbox', name: 'src-sandbox' },
		fork: vi.fn(async () => ({ name: 'forked-sandbox', snapshotId: 'snap_123', type: 'sandbox' as const })),
		...overrides,
	} as unknown as Snapshot;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('blaxel sandbox.create from snapshot', () => {
	it('forks a new sandbox when snapshotId is passed', async () => {
		const core = await mockedCore();
		const snapshot = makeSnapshot();
		vi.mocked(core.Snapshot.get).mockResolvedValue(snapshot);
		const forked = makeSandbox('forked-sandbox');
		vi.mocked(core.SandboxInstance.get).mockResolvedValue(forked);

		const provider = blaxel({});
		const sandbox = await provider.sandbox.create({ snapshotId: 'snap_123' });

		expect(core.Snapshot.get).toHaveBeenCalledWith('snap_123');
		expect(snapshot.fork).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ targetType: 'sandbox' })
		);
		// The live sandbox id is the fork's name, not the snapshot id.
		expect(core.SandboxInstance.get).toHaveBeenCalledWith('forked-sandbox');
		expect(sandbox.sandboxId).toBe('forked-sandbox');
	});

	it('uses options.name as the fork target name and forwards envs', async () => {
		const core = await mockedCore();
		const fork = vi.fn(async () => ({ name: 'my-fork', snapshotId: 'snap_123', type: 'sandbox' as const }));
		vi.mocked(core.Snapshot.get).mockResolvedValue(makeSnapshot({ fork }));
		vi.mocked(core.SandboxInstance.get).mockResolvedValue(makeSandbox('my-fork'));

		const provider = blaxel({});
		await provider.sandbox.create({
			snapshotId: 'snap_123',
			name: 'my-fork',
			envs: { FOO: 'bar' },
		});

		expect(fork).toHaveBeenCalledWith('my-fork', {
			targetType: 'sandbox',
			envs: [{ name: 'FOO', value: 'bar' }],
		});
	});

	it('resumes a live sandbox when sandboxId is passed without touching snapshots', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.get).mockResolvedValue(makeSandbox('live-sandbox'));

		const provider = blaxel({});
		const sandbox = await provider.sandbox.create({ sandboxId: 'live-sandbox' });

		expect(core.SandboxInstance.get).toHaveBeenCalledWith('live-sandbox');
		expect(core.Snapshot.get).not.toHaveBeenCalled();
		expect(sandbox.sandboxId).toBe('live-sandbox');
	});

	it('prefers sandboxId over snapshotId when both are passed', async () => {
		const core = await mockedCore();
		vi.mocked(core.SandboxInstance.get).mockResolvedValue(makeSandbox('live-sandbox'));

		const provider = blaxel({});
		await provider.sandbox.create({ sandboxId: 'live-sandbox', snapshotId: 'snap_123' });

		expect(core.SandboxInstance.get).toHaveBeenCalledWith('live-sandbox');
		expect(core.Snapshot.get).not.toHaveBeenCalled();
	});
});

describe('blaxel snapshot manager', () => {
	it('captures a workspace snapshot via Snapshot.create', async () => {
		const core = await mockedCore();
		vi.mocked(core.Snapshot.create).mockResolvedValue(makeSnapshot());

		const provider = blaxel({});
		const snapshot = await provider.snapshot!.create('src-sandbox', { name: 'my-snapshot' });

		expect(core.Snapshot.create).toHaveBeenCalledWith({
			name: 'my-snapshot',
			source: { name: 'src-sandbox' },
		});
		expect(snapshot).toMatchObject({
			id: 'snap_123',
			provider: 'blaxel',
			metadata: { name: 'my-snapshot', sourceSandbox: 'src-sandbox' },
		});
	});

	it('lists workspace snapshots via Snapshot.list', async () => {
		const core = await mockedCore();
		vi.mocked(core.Snapshot.list).mockResolvedValue([
			makeSnapshot({ id: 'snap_1' } as Partial<Snapshot>),
			makeSnapshot({ id: 'snap_2' } as Partial<Snapshot>),
		] as never);

		const provider = blaxel({});
		const snapshots = await provider.snapshot!.list();

		expect(snapshots.map((s: { id: string }) => s.id)).toEqual(['snap_1', 'snap_2']);
	});

	it('lists a sandbox’s own snapshots when sandboxId is passed', async () => {
		const core = await mockedCore();
		const snapshotsResource = { list: vi.fn(async () => [makeSnapshot()]) };
		vi.mocked(core.SandboxInstance.get).mockResolvedValue({
			...makeSandbox('src-sandbox'),
			snapshots: snapshotsResource,
		} as unknown as SandboxInstance);

		const provider = blaxel({});
		const snapshots = await provider.snapshot!.list({ sandboxId: 'src-sandbox' });

		expect(core.SandboxInstance.get).toHaveBeenCalledWith('src-sandbox');
		expect(snapshotsResource.list).toHaveBeenCalled();
		expect(core.Snapshot.list).not.toHaveBeenCalled();
		expect(snapshots).toHaveLength(1);
	});

	it('honors list limit by stopping the auto-paging iteration', async () => {
		const core = await mockedCore();
		vi.mocked(core.Snapshot.list).mockResolvedValue([
			makeSnapshot({ id: 'snap_1' } as Partial<Snapshot>),
			makeSnapshot({ id: 'snap_2' } as Partial<Snapshot>),
			makeSnapshot({ id: 'snap_3' } as Partial<Snapshot>),
		] as never);

		const provider = blaxel({});
		const snapshots = await provider.snapshot!.list({ limit: 2 });

		expect(snapshots).toHaveLength(2);
	});

	it('deletes a snapshot via Snapshot.delete, not SandboxInstance.delete', async () => {
		const core = await mockedCore();
		vi.mocked(core.Snapshot.delete).mockResolvedValue(undefined as never);

		const provider = blaxel({});
		await provider.snapshot!.delete('snap_123');

		expect(core.Snapshot.delete).toHaveBeenCalledWith('snap_123');
		expect(core.SandboxInstance.delete).not.toHaveBeenCalled();
	});
});

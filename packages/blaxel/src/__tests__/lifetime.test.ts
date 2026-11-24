/**
 * The lifetime a sandbox create sends to Blaxel (mock-only).
 *
 * Blaxel rejects a ttl under 5 minutes. A shorter timeout goes out as an
 * absolute `expires` date, so the sandbox ends when the caller asked instead
 * of at the 5m floor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxInstance } from '@blaxel/core';
import { blaxel } from '../index';

vi.mock('@blaxel/core', () => ({
	initialize: vi.fn(),
	settings: {},
	SandboxInstance: { get: vi.fn(), delete: vi.fn(), createIfNotExists: vi.fn() },
	Snapshot: { get: vi.fn(), create: vi.fn(), list: vi.fn(), delete: vi.fn() },
}));

const created = { metadata: { name: 'sbx-1' }, spec: { runtime: { image: 'blaxel/base-image:latest' } } } as unknown as SandboxInstance;
const now = new Date('2026-11-24T18:00:00.000Z');

function sent(): Record<string, unknown> {
	return vi.mocked(SandboxInstance.createIfNotExists).mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(now);
	vi.mocked(SandboxInstance.createIfNotExists).mockResolvedValue(created);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('Blaxel sandbox lifetime (mock-only)', () => {
	it('sends a timeout under 5 minutes as an expires date, not a 5m ttl', async () => {
		await blaxel({}).instances.create({ timeout: 240_000 } as never);

		expect(sent().expires).toEqual(new Date(now.getTime() + 240_000));
		expect(sent().ttl).toBeUndefined();
	});

	it('sends a timeout of 5 minutes or more as a ttl', async () => {
		await blaxel({}).instances.create({ timeout: 600_000 } as never);

		expect(sent().ttl).toBe('600s');
		expect(sent().expires).toBeUndefined();
	});

	it('lets a ttl in provider options replace the timeout, floor included', async () => {
		await blaxel({}).instances.create({ timeout: 240_000, ttl: '2m' } as never);

		expect(sent().ttl).toBe('300s');
		expect(sent().expires).toBeUndefined();
	});

	it('sends no lifetime without a timeout', async () => {
		await blaxel({}).instances.create({} as never);

		expect(sent().ttl).toBeUndefined();
		expect(sent().expires).toBeUndefined();
	});
});

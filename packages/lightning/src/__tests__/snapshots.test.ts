/**
 * Focused unit tests for the Lightning snapshot method group.
 *
 * Drives the real provider code (snapshot.create / list / delete) against a
 * mocked `@lightningai/sdk`, so it runs without a live LIGHTNING_API_KEY and
 * verifies the wiring onto the SDK's `createSnapshot` / `listSnapshots` /
 * `deleteSnapshot`.
 */

import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ deleteSpy: vi.fn() }));

vi.mock('@lightningai/sdk', () => {
  const snap1 = {
    id: 'snap-1',
    status: 'ready',
    sizeBytes: 12345,
    sourceSandboxId: 'sb-123',
    sourceSandboxName: 'snap-src',
    runtime: 'node24',
    auto: false,
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
    expiresAt: null,
  };
  const snap2 = { ...snap1, id: 'snap-2', sourceSandboxId: 'sb-999' };

  const makeNative = (sandboxId = 'sb-123') => ({
    sandboxId,
    name: 'snap-src',
    status: 'running',
    ports: [] as string[],
    portUrls: {} as Record<string, string>,
    instanceType: 'cpu-1',
    runtime: 'node24',
    timeout: 0,
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
    getPortUrl: () => '',
    createSnapshot: async () => snap1,
    runCommand: async () => ({ output: '', exitCode: 0 }),
    writeFile: async () => {},
    readFile: async () => null,
    delete: async () => {},
    fs: {
      mkdir: async () => {},
      exists: async () => true,
      readdir: async () => [],
      stat: async () => ({ fileType: 'file', size: 0, mtime: new Date(), mode: '' }),
      rm: async () => {},
    },
  });

  class Sandbox {
    static configure(): void {}
    static async create() {
      return makeNative();
    }
    static async get({ sandboxId }: { sandboxId: string }) {
      return makeNative(sandboxId);
    }
    static async list() {
      return { sandboxes: [makeNative()] };
    }
    static async listSnapshots() {
      return { snapshots: [snap1, snap2] };
    }
    static async getSnapshot() {
      return snap1;
    }
    static async deleteSnapshot(id: string) {
      h.deleteSpy(id);
    }
  }

  return { Sandbox };
});

// Imported after the mock so the dynamic import resolves to the fake SDK.
import { lightning } from '../index';

describe('lightning snapshots', () => {
  it('captures a snapshot from a sandbox and normalizes it', async () => {
    const provider = lightning({ apiKey: 'test-key' });

    const snap = await provider.snapshot!.create('sb-123');

    expect(snap.id).toBe('snap-1');
    expect(snap.provider).toBe('lightning');
    expect(snap.createdAt).toBeInstanceOf(Date);
    expect(snap.metadata.status).toBe('ready');
    expect(snap.metadata.sourceSandboxId).toBe('sb-123');
    expect(snap.metadata.sizeBytes).toBe(12345);
    expect(snap.metadata.auto).toBe(false);
  });

  it('lists snapshots, normalizing each', async () => {
    const provider = lightning({ apiKey: 'test-key' });

    const snaps = await provider.snapshot!.list();

    expect(snaps.map((s) => s.id)).toEqual(['snap-1', 'snap-2']);
    expect(snaps.every((s) => s.provider === 'lightning')).toBe(true);
  });

  it('filters snapshots by sandboxId client-side', async () => {
    const provider = lightning({ apiKey: 'test-key' });

    const snaps = await provider.snapshot!.list({ sandboxId: 'sb-999' });

    expect(snaps.map((s) => s.id)).toEqual(['snap-2']);
  });

  it('deletes a snapshot by id', async () => {
    const provider = lightning({ apiKey: 'test-key' });

    await provider.snapshot!.delete('snap-1');

    expect(h.deleteSpy).toHaveBeenCalledWith('snap-1');
  });
});

/**
 * Standard-size mapping for Buddy (mock-only, no API calls).
 *
 * Buddy sizes a sandbox with one `resources` preset, `NxM` = N vCPU / M GB RAM,
 * from 1x2 to 12x24 (always 2 GB per vCPU). Disk is fixed at 50 GB.
 * Sources: https://buddy.works/docs/sandboxes/configuration,
 * https://buddy.works/docs/api/sandboxes/create, @buddy-works/sandbox-sdk types.
 *
 * Ways the mapping could fail, each covered below:
 * 1. Wrong shape: a class maps to a preset below its profile (e.g. md -> 1x2)
 *    or to a bigger preset than the smallest one that belongs to it (md -> 3x6).
 * 2. A class Buddy cannot serve (xs, 2xl, 3xl) is reported supported, or as
 *    `unknown` instead of `unsupported`, or clamps silently to 1x2/12x24.
 * 3. Silent default boot: the preset is resolved but never reaches the
 *    `addSandbox` body, so Buddy boots its 2x4 default (or config.resources).
 * 4. Dropped field on the snapshot/template restore path: `snapshot_id`
 *    creates lose `resources`.
 * 5. Conflict accepted: `sizeClass` combined with `resources`, `cpu`, `cpus`,
 *    `vcpus`, `memory`, `memoryMb`, `memoryMiB` or `memMiB` is not rejected
 *    with InstanceSizeError('conflict') and no request is sent.
 * 6. `resolved` omits the fixed 50 GB disk or misstates CPU/RAM.
 * 7. SDK-only `sizeClass` leaks into the vendor request body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuddyApiClient } from '@buddy-works/sandbox-sdk';
import { InstanceSizeError } from '@computesdk/provider';

import { BUDDY_DISK_MIB, BUDDY_SIZE_PRESETS, buddy } from '../index';

const config = { token: 't', workspace: 'w', project: 'p' };

const expected = {
  sm: { resources: '1x2', vcpus: 1, memoryMiB: 2048 },
  md: { resources: '2x4', vcpus: 2, memoryMiB: 4096 },
  lg: { resources: '4x8', vcpus: 4, memoryMiB: 8192 },
  xl: { resources: '8x16', vcpus: 8, memoryMiB: 16384 },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let addSandbox: any;
const bodies = (): Record<string, unknown>[] => addSandbox.mock.calls.map((call: [{ body: Record<string, unknown> }]) => call[0].body);

beforeEach(() => {
  addSandbox = vi.spyOn(BuddyApiClient.prototype, 'addSandbox')
    .mockImplementation(async ({ body }: any) => ({ id: 'sb-1', identifier: 'sb-1', timeout: body.timeout }) as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  // ensureTimeout must not need a second request: the mock echoes the timeout.
  vi.spyOn(BuddyApiClient.prototype, 'updateSandbox').mockRejectedValue(new Error('unexpected update'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Buddy standard sizes', () => {
  it('maps sm/md/lg/xl to the smallest preset that meets each profile, with the fixed disk', () => {
    const sizes = buddy(config).sizes;
    for (const [sizeClass, shape] of Object.entries(expected)) {
      const resolution = sizes.resolve(sizeClass as keyof typeof expected);
      expect(resolution).toMatchObject({
        status: 'supported',
        nativeOptions: { resources: shape.resources },
        resolved: { vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: 51200 },
      });
      expect(resolution).not.toHaveProperty('belowStandard');
    }
    expect(BUDDY_DISK_MIB).toBe(51200);
    expect(BUDDY_SIZE_PRESETS).toEqual({ sm: '1x2', md: '2x4', lg: '4x8', xl: '8x16' });
  });

  it('refuses xs, 2xl and 3xl as unsupported with the preset limits', () => {
    const list = buddy(config).sizes.list();
    expect(list.filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['sm', 'md', 'lg', 'xl']);
    for (const sizeClass of ['xs', '2xl', '3xl'] as const) {
      const resolution = list.find(r => r.requested.sizeClass === sizeClass)!;
      expect(resolution.status).toBe('unsupported');
      expect((resolution as { reason: string }).reason).toMatch(sizeClass === 'xs' ? /1x2/ : /12x24/);
    }
  });

  it('rejects an unsupported class at create without sending a request', async () => {
    const provider = buddy(config);
    for (const sizeClass of ['xs', '2xl', '3xl'] as const) {
      const error = await provider.sandbox.create({ sizeClass }).catch(e => e);
      expect(error).toBeInstanceOf(InstanceSizeError);
      expect(error.code).toBe('unsupported');
    }
    expect(addSandbox).not.toHaveBeenCalled();
  });

  it('sends the preset in the create body and reports the resolved shape', async () => {
    const provider = buddy({ ...config, resources: '12x24' });
    for (const [sizeClass, shape] of Object.entries(expected)) {
      addSandbox.mockClear();
      const sandbox = await provider.sandbox.create({ sizeClass: sizeClass as keyof typeof expected });
      const [body] = bodies();
      expect(body.resources).toBe(shape.resources);
      expect(body).not.toHaveProperty('sizeClass');
      expect(sandbox.sizing).toMatchObject({
        requested: { sizeClass },
        resolved: { vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: 51200 },
      });
    }
  });

  it('keeps the preset on snapshot and template restores', async () => {
    const provider = buddy(config);
    await provider.sandbox.create({ sizeClass: 'lg', snapshotId: 'snap-1' });
    await provider.sandbox.create({ sizeClass: 'md', templateId: 'snap-2' });
    expect(bodies()).toEqual([
      expect.objectContaining({ snapshot_id: 'snap-1', resources: '4x8' }),
      expect.objectContaining({ snapshot_id: 'snap-2', resources: '2x4' }),
    ]);
  });

  it('rejects competing native CPU/RAM fields as a conflict', async () => {
    const provider = buddy(config);
    const natives = [
      { resources: '4x8' }, { cpu: 4 }, { cpus: 4 }, { vcpus: 4 },
      { memory: 8192 }, { memoryMb: 8192 }, { memoryMiB: 8192 }, { memMiB: 8192 },
    ];
    for (const native of natives) {
      const error = await provider.sandbox.create({ sizeClass: 'lg', ...native } as any).catch(e => e); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(error).toBeInstanceOf(InstanceSizeError);
      expect(error.code).toBe('conflict');
      expect(() => provider.sizes.resolve('lg', native as any)).toThrow(InstanceSizeError); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    expect(addSandbox).not.toHaveBeenCalled();
  });

  it('leaves creates without sizeClass on the native path', async () => {
    const provider = buddy({ ...config, resources: '3x6' });
    await provider.sandbox.create();
    await provider.sandbox.create({ cpu: 4 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(bodies().map(b => b.resources)).toEqual(['3x6', '4x8']);
    expect((await provider.sandbox.create()).sizing).toBeUndefined();
  });
});

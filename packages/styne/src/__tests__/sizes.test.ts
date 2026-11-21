/**
 * Styne standard-size mapping against a local HTTP/2 server (no API key, no sandbox boots).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class maps to another Styne size, or declares numbers the size does not have.
 * - Missing size claimed: xs/sm (no 1-vCPU size) or 3xl (above 16 vCPU) claim support.
 * - Silent default boot: an unsupported class reaches POST /sandboxes and boots `default`.
 * - Dropped field: the create path forgets `size` on the way to the API.
 * - Fixed-size sources: sizeClass with snapshotId, image or templateId boots the source's own size.
 * - Conflict accepted: the native `size` or CPU/RAM fields alongside sizeClass silently win or lose.
 * - Raw fields dropped: the universal `vcpus`, `memoryMiB` and `diskMiB` fields boot `default` instead of the size
 *   they ask for, or a size Styne cannot give boots another shape.
 * - Foreign fields read: another provider's own field (`cpu`, `memory`, `resources`, `tier`, ...) changes or fails
 *   a Styne create, which the options contract leaves to that provider.
 */
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeSessions } from '../client';
import type { CreateInstanceOptions } from '@computesdk/provider';
import { createBody, sizeClassOf, sizeRequestOf, STYNE_SIZE_SHAPES, styne } from '../provider';
import type { StyneInstance } from '../provider';

const expected = {
  md: { size: 'small', vcpus: 2, memoryMiB: 4096, diskMiB: 52224 },
  lg: { size: 'default', vcpus: 4, memoryMiB: 8192, diskMiB: 52224 },
  xl: { size: 'large', vcpus: 8, memoryMiB: 16384, diskMiB: 113664 },
  '2xl': { size: 'xlarge', vcpus: 16, memoryMiB: 32768, diskMiB: 257024 },
} as const;
type Supported = keyof typeof expected;

describe('Styne standard size mapping', () => {
  let server: http2.Http2Server;
  const creates: Record<string, unknown>[] = [];

  beforeAll(async () => {
    server = http2.createServer();
    server.on('stream', (stream, headers) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        if (headers[':method'] === 'GET' && headers[':path'] === '/sandboxes') {
          stream.respond({ ':status': 200, 'content-type': 'application/json' });
          stream.end(JSON.stringify([{ sandboxID: 'sbx-2', metadata: { name: 'run-1-i0' } }, { sandboxID: 'sbx-3' }]));
          return;
        }
        if (headers[':method'] === 'POST' && headers[':path'] === '/sandboxes') {
          creates.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          stream.respond({ ':status': 201, 'content-type': 'application/json' });
          stream.end(JSON.stringify({ sandboxID: 'sbx-1' }));
          return;
        }
        stream.respond({ ':status': 500 });
        stream.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    closeSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    creates.length = 0;
  });

  const provider = () => {
    const { port } = server.address() as AddressInfo;
    return styne({ apiKey: 'test-key', apiUrl: `http://127.0.0.1:${port}` });
  };

  it('supports exactly md, lg, xl and 2xl', () => {
    const list = provider().sizes.list();
    expect(list.filter((r) => r.status === 'supported').map((r) => r.requested.sizeClass)).toEqual(['md', 'lg', 'xl', '2xl']);
    expect(Object.keys(STYNE_SIZE_SHAPES)).toEqual(['md', 'lg', 'xl', '2xl']);
  });

  it.each(Object.entries(expected))('%s resolves to the Styne size %o', (sizeClass, shape) => {
    const r = provider().sizes.resolve(sizeClass as Supported);
    expect(r.status).toBe('supported');
    if (r.status !== 'supported') return;
    expect(r.nativeOptions).toEqual({ size: shape.size });
    expect(r.resolved).toEqual({ vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: shape.diskMiB });
    expect(r.provenance).toBe('adapter-declared');
    expect(r.belowStandard).toBeUndefined();
  });

  it.each(['xs', 'sm', '3xl'] as const)('%s is unsupported with a reason', (sizeClass) => {
    const r = provider().sizes.resolve(sizeClass);
    expect(r.status).toBe('unsupported');
    if (r.status === 'supported') return;
    expect(r.reason).toMatch(sizeClass === '3xl' ? /largest Styne size/ : /no 1-vCPU size/);
  });

  it.each(Object.entries(expected))('create({ sizeClass: %s }) sends the size and records the sizing', async (sizeClass, shape) => {
    const sandbox = await provider().instances.create({ sizeClass: sizeClass as Supported, templateId: undefined, timeout: 60_000 });
    expect(creates).toEqual([{ size: shape.size, timeout: 60 }]);
    expect(sandbox.sizing?.requested.sizeClass).toBe(sizeClass);
    expect(sandbox.sizing?.resolved).toEqual({ vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: shape.diskMiB });
  });

  it.each(['xs', 'sm', '3xl'] as const)('create({ sizeClass: %s }) rejects before any create', async (sizeClass) => {
    await expect(provider().instances.create({ sizeClass })).rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false });
    expect(creates).toHaveLength(0);
  });

  it.each([{ snapshotId: 'snap-1' }, { image: 'python:3.12-slim' }, { templateId: 'base' }])(
    'refuses sizeClass with a fixed-size source: %o',
    async (source) => {
      const r = provider().sizes.resolve('md', source);
      expect(r.status).toBe('unsupported');
      await expect(provider().instances.create({ sizeClass: 'md', ...source })).rejects.toMatchObject({ code: 'unsupported' });
      expect(creates).toHaveLength(0);
    },
  );

  it.each([{ size: 'large' }, { vcpus: 2 }, { memoryMiB: 4096 }, { memoryMb: 4096 }])(
    'rejects native resource fields alongside sizeClass: %o',
    async (native) => {
      await expect(provider().instances.create({ sizeClass: 'md', ...native })).rejects.toMatchObject({ code: 'conflict' });
      expect(() => provider().sizes.resolve('md', native)).toThrow(/cannot combine sizeClass/);
      expect(creates).toHaveLength(0);
    },
  );

  it('sends the native size without sizeClass, and nothing when neither is given', async () => {
    await provider().instances.create({ size: 'large' });
    await provider().instances.create({});
    expect(creates).toEqual([{ size: 'large' }, {}]);
    expect(createBody({}, { size: 'xlarge', templateId: 'xlarge' })).toEqual({ size: 'xlarge', templateID: 'xlarge' });
  });

  it('refuses the native size with a snapshot or an image, which keep their own size', () => {
    expect(() => createBody({}, { size: 'small', snapshotId: 'snap-1' })).toThrow(/keeps the size it was made with/);
    expect(() => createBody({}, { size: 'small', image: 'alpine' })).toThrow(/keeps the size it was made with/);
  });

  describe('universal CPU, memory and disk fields', () => {
    const expectSize = async (options: Record<string, unknown>, size: string) => {
      const sandbox = await provider().instances.create(options as CreateInstanceOptions);
      expect(creates).toEqual([{ size }]);
      // As for every provider, only a sizeClass create records sandbox.sizing.
      expect(sandbox.sizing).toBeUndefined();
    };

    it.each(['vcpus', 'cpus'])('%s: 8 boots the 8-vCPU size', (field) => expectSize({ [field]: 8 }, 'large'));

    it.each(['memoryMiB', 'memMiB', 'memoryMb'])('%s: 16384 (MiB) boots the smallest size with 16 GiB', (field) =>
      expectSize({ [field]: 16384 }, 'large'),
    );

    it.each(['diskMiB', 'diskMb'])('%s: 60000 (MiB) boots the smallest size with that disk', (field) => expectSize({ [field]: 60000 }, 'large'));

    // 8 vCPU / 16 GiB written the way other providers' callers write it.
    it.each([
      ['archil, uno, givemeanode', { vcpus: 8, memoryMiB: 16384 }],
      ['isorun', { vcpus: 8, memMiB: 16384 }],
      ['tensorlake', { cpus: 8, memoryMb: 16000 }],
      ['isorun with disk', { vcpus: 8, memMiB: 16384, diskMiB: 65536 }],
    ])('%s entry boots large (8 vCPU / 16 GiB)', (_name, options) => expectSize(options, 'large'));

    it.each([
      [{ vcpus: 2, memoryMiB: 4096 }, 'small'],
      [{ vcpus: 4, memoryMiB: 8192 }, 'default'],
      [{ vcpus: 16, memoryMiB: 32768 }, 'xlarge'],
      [{ vcpus: 2 }, 'small'],
      [{ memoryMiB: 4000 }, 'small'],
      [{ memoryMiB: 6144 }, 'default'],
      [{ memoryMiB: 20000 }, 'xlarge'],
      [{ vcpus: 8, memoryMiB: 8192 }, 'large'],
    ])('%o boots %s', (options, size) => expectSize(options, size));

    it('keeps the other options next to the size', async () => {
      await provider().instances.create({ vcpus: 8, memoryMiB: 16384, timeout: 60_000, envs: { A: '1' }, name: 'dax' } as CreateInstanceOptions);
      expect(creates).toEqual([{ size: 'large', timeout: 60, envVars: { A: '1' }, metadata: { name: 'dax' } }]);
      expect(createBody({}, { vcpus: 16 } as CreateInstanceOptions)).toEqual({ size: 'xlarge' });
    });

    it.each([
      { cpu: 8, memory: 16384 },
      { cpuCount: 8, memoryGB: 16 },
      { resources: { vcpus: 8 } },
      { resources: '8x16' },
      { launch_parameters: { resource_size_request: 'CUSTOM_SIZE', custom_cpu_cores: 8 } },
      { shape: 's-8vcpu-16gb' },
      { tier: 'medium', instanceType: 'cpu-8', vmTier: 'Small', deploymentPlan: 'pro', gpu: 1 },
    ])("leaves another provider's own fields to it: %o", async (options) => {
      await provider().instances.create(options as CreateInstanceOptions);
      expect(creates).toEqual([{}]);
    });

    it.each([
      [{ vcpus: 1, memoryMiB: 2048 }, /2, 4, 8 or 16 vCPU/],
      [{ vcpus: 1 }, /2, 4, 8 or 16 vCPU/],
      [{ vcpus: 3 }, /2, 4, 8 or 16 vCPU/],
      [{ vcpus: 32, memoryMiB: 65536 }, /2, 4, 8 or 16 vCPU/],
      [{ vcpus: 2, memoryMiB: 8192 }, /2-vCPU Styne size \(small\) has 4 GiB memory/],
      [{ cpus: 4, memoryMb: 16384 }, /4-vCPU Styne size \(default\) has 8 GiB memory/],
      [{ vcpus: 8, diskMiB: 200_000 }, /8-vCPU Styne size \(large\) has 16 GiB memory and 111 GiB disk/],
      [{ memoryMiB: 65536 }, /largest Styne size is xlarge/],
      [{ diskMiB: 300 * 1024 }, /largest Styne size is xlarge/],
    ])('%o is unsupported and starts nothing', async (options, message) => {
      const error = await provider().instances.create(options as CreateInstanceOptions).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false });
      expect((error as Error).message).toMatch(message);
      expect(creates).toHaveLength(0);
    });

    it.each([
      [{ memoryMiB: 8 }, /read in MiB/],
      [{ diskMiB: 50 }, /read in MiB/],
      [{ vcpus: 2.5 }, /whole vCPUs/],
      [{ vcpus: 0 }, /positive number/],
      [{ vcpus: '8' }, /positive number/],
      [{ memoryMiB: Number.NaN }, /positive number/],
    ])('%o is invalid and starts nothing', async (options, message) => {
      const error = await provider().instances.create(options as CreateInstanceOptions).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'InstanceSizeError', code: 'invalid' });
      expect((error as Error).message).toMatch(message);
      expect(creates).toHaveLength(0);
    });

    it.each([{ vcpus: 8, cpus: 4 }, { memoryMiB: 16384, memMiB: 8192 }])('fields that disagree are a conflict: %o', async (options) => {
      await expect(provider().instances.create(options as CreateInstanceOptions)).rejects.toMatchObject({ code: 'conflict' });
      expect(creates).toHaveLength(0);
    });

    it.each([{ vcpus: 2 }, { cpus: 2 }, { memMiB: 4096 }, { memoryMb: 4096 }, { diskMiB: 1000 }, { diskMb: 1000 }])(
      'a universal field next to sizeClass is a conflict: %o',
      async (raw) => {
        await expect(provider().instances.create({ sizeClass: 'md', ...raw } as CreateInstanceOptions)).rejects.toMatchObject({ code: 'conflict' });
        expect(() => provider().sizes.resolve('md', raw as CreateInstanceOptions)).toThrow(/cannot combine sizeClass/);
        expect(creates).toHaveLength(0);
      },
    );

    it('a universal field next to the native size is a conflict', async () => {
      await expect(provider().instances.create({ size: 'large', vcpus: 8 } as CreateInstanceOptions)).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringMatching(/native Styne size with vcpus/),
      });
      expect(creates).toHaveLength(0);
    });

    it.each([{ snapshotId: 'snap-1' }, { image: 'node:22' }, { templateId: 'node:22' }])(
      'universal fields with a fixed-size source are unsupported: %o',
      async (source) => {
        await expect(provider().instances.create({ vcpus: 8, memoryMiB: 16384, ...source } as CreateInstanceOptions)).rejects.toMatchObject({
          code: 'unsupported',
        });
        expect(creates).toHaveLength(0);
      },
    );

    it('keeps the instance manager the framework built', () => {
      const instances = provider().instances;
      const descriptor = Object.getOwnPropertyDescriptor(instances, 'create');
      expect(descriptor === undefined || descriptor.writable !== false).toBe(true);
    });

    it('reads requests without starting anything', () => {
      expect(sizeRequestOf({})).toBeUndefined();
      expect(sizeRequestOf({ timeout: 1000, cpu: 8, memory: 16384 } as CreateInstanceOptions)).toBeUndefined();
      expect(sizeRequestOf({ vcpus: 8, memMiB: 16384 } as CreateInstanceOptions)).toEqual({ vcpus: 8, memoryMiB: 16384, fields: ['vcpus', 'memMiB'] });
      expect(sizeClassOf({ vcpus: 16, fields: ['vcpus'] })).toBe('2xl');
    });
  });

  it('keeps the create name on the instance, and reads it back from the list', async () => {
    const sandbox = await provider().instances.create({ name: 'run-1-i9' });
    expect((sandbox.getInstance() as StyneInstance).name).toBe('run-1-i9');
    const listed = await provider().instances.list();
    expect(listed.map((s) => (s.getInstance() as StyneInstance).name)).toEqual(['run-1-i0', undefined]);
  });
});

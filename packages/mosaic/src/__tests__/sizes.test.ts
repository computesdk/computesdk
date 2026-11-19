/**
 * Mosaic standard size mapping (mock-only; no API calls leave the process).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class sends a vcpu/memory_mb pair other than its profile, or one Mosaic
 *   does not list (stock shapes are 1/2048, 2/4096, 4/8192, plus 8/16384 and 16/32768 on `base`).
 * - Wrong template: xl/2xl boot a template that only serves 1-4 vCPU (400 unsupported_shape),
 *   or xs boots a stock template, whose smallest shape is 1/2048.
 * - Silent default boot: the resolved shape is dropped and the create sends the config
 *   default (2 vCPU / 4096 MiB) or the caller's configured template/environment shape.
 * - Dropped field: templateId, vcpus or memoryMb from nativeOptions never reach the
 *   POST /v1/sandboxes body (memory_mb, vcpu, template, snapshot_id).
 * - Restores accepted: a snapshot/environment (fixed captured shape) is paired with a size.
 * - Conflict accepted: native CPU/RAM fields (core aliases or Mosaic's vcpu/memory_mb) are
 *   combined with sizeClass instead of raising InstanceSizeError('conflict').
 * - Unoffered size accepted: 3xl (32 vCPU / 64 GiB) exceeds Mosaic's 16 vCPU / 32 GiB cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mosaic, MOSAIC_SIZE_TEMPLATES } from '../index';

const bodies: Array<Record<string, unknown>> = [];
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body ?? '{}')));
  return new Response(JSON.stringify({ id: 'sbx-1', state: 'running', tti_ms: 1 }), { status: 200 });
});

const provider = (config: Record<string, unknown> = {}) =>
  mosaic({ baseUrl: 'https://mosaic.test', apiKey: 'msk_test', ...config });

const native = [
  ['sm', 1, 2048, 'node-20'],
  ['md', 2, 4096, 'node-20'],
  ['lg', 4, 8192, 'node-20'],
  ['xl', 8, 16384, 'base'],
  ['2xl', 16, 32768, 'base'],
] as const;

describe('Mosaic standard size mapping (mock-only)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { bodies.length = 0; fetchMock.mockClear(); vi.unstubAllGlobals(); });

  it('supports xs through 2xl and refuses 3xl as unsupported', () => {
    const list = provider().sizes.list();
    expect(list.filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
    const xxxl = provider().sizes.resolve('3xl');
    expect(xxxl).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/16 vCPU \/ 32768 MiB/) });
  });

  it.each(native)('boots %s at exactly its profile', async (sizeClass, vcpus, memoryMiB, template) => {
    const result = await provider().instances.create({ sizeClass });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ template, vcpu: vcpus, memory_mb: memoryMiB });
    expect(bodies[0]).not.toHaveProperty('snapshot_id');
    expect(bodies[0]).not.toHaveProperty('sizeClass');
    expect(result.sizing).toEqual({
      requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared',
    });
  });

  it('boots xs from its 1 vCPU / 1024 MiB size environment', async () => {
    const result = await provider().instances.create({ sizeClass: 'xs' });
    expect(bodies[0]).toMatchObject({ snapshot_id: MOSAIC_SIZE_TEMPLATES.xs, vcpu: 1, memory_mb: 1024 });
    expect(bodies[0]).not.toHaveProperty('template');
    expect(result.sizing?.resolved).toEqual({ vcpus: 1, memoryMiB: 1024 });
  });

  it('honors a sizeTemplates override for xs', async () => {
    await provider({ sizeTemplates: { xs: 'my-1cpu-1gb' } }).instances.create({ sizeClass: 'xs' });
    expect(bodies[0]).toMatchObject({ snapshot_id: 'my-1cpu-1gb', vcpu: 1, memory_mb: 1024 });
  });

  it('overrides config default shape and keeps a caller stock template for small shapes', async () => {
    await provider({ vcpu: 4, memoryMb: 8192, template: 'python-3.11' }).instances.create({ sizeClass: 'sm' });
    await provider().instances.create({ sizeClass: 'md', templateId: 'node-22' });
    await provider().instances.create({ sizeClass: 'lg', runtime: 'python' });
    expect(bodies[0]).toMatchObject({ template: 'python-3.11', vcpu: 1, memory_mb: 2048 });
    expect(bodies[1]).toMatchObject({ template: 'node-22', vcpu: 2, memory_mb: 4096 });
    expect(bodies[2]).toMatchObject({ template: 'python-3.11', vcpu: 4, memory_mb: 8192 });
  });

  it('moves large shapes to base, including runtime requests and explicit base', async () => {
    await provider().instances.create({ sizeClass: 'xl', runtime: 'python' });
    await provider({ template: 'base' }).instances.create({ sizeClass: '2xl' });
    await provider().instances.create({ sizeClass: '2xl', templateId: 'base' });
    expect(bodies).toEqual([
      expect.objectContaining({ template: 'base', vcpu: 8, memory_mb: 16384 }),
      expect.objectContaining({ template: 'base', vcpu: 16, memory_mb: 32768 }),
      expect.objectContaining({ template: 'base', vcpu: 16, memory_mb: 32768 }),
    ]);
  });

  it.each([
    [{}, { sizeClass: '3xl' }],
    [{}, { sizeClass: 'xl', templateId: 'node-22' }],
    [{ template: 'node-22' }, { sizeClass: '2xl' }],
    [{}, { sizeClass: 'xs', templateId: 'node-20' }],
    [{}, { sizeClass: 'md', snapshotId: 'snap-1' }],
    [{}, { sizeClass: 'md', image: 'python:3.12-slim' }],
    [{}, { sizeClass: 'md', templateId: 'my-env' }],
    [{ template: 'my-env' }, { sizeClass: 'sm' }],
  ])('refuses as unsupported without creating: config %j, options %j', async (config, options) => {
    await expect(provider(config).instances.create(options as any))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { sizeClass: 'md', vcpus: 2 }, { sizeClass: 'md', cpus: 2 }, { sizeClass: 'md', cpu: 2 },
    { sizeClass: 'md', memoryMb: 4096 }, { sizeClass: 'md', memoryMiB: 4096 }, { sizeClass: 'md', memory: 4096 },
    { sizeClass: 'md', vcpu: 2 }, { sizeClass: 'md', memory_mb: 4096 }, { sizeClass: 'md', memoryMB: 4096 },
  ])('rejects native CPU/RAM conflicts without creating: %j', async (options) => {
    await expect(provider().instances.create(options as any))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'conflict', fallback: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves native creates without sizeClass untouched', async () => {
    await provider().instances.create({ vcpus: 4, memoryMb: 8192 });
    expect(bodies[0]).toMatchObject({ template: 'node-20', vcpu: 4, memory_mb: 8192 });
  });
});

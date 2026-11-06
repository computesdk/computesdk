import { afterEach, describe, expect, it, vi } from 'vitest';
import { agent37 } from '../index';

const instance = { id: 'new', status: 'running', template: 'agent37-base', type: 'default', region: 'us', resources: { cpu: 2, memory: 4, disk: 4 }, url: 'https://new.invalid', created: 0 };
function mockFetch() {
  const fetch = vi.fn(async () => ({ ok: true, status: 201, text: async () => JSON.stringify(instance) }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Agent37 standard size mapping (mock-only)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('discovers sizes without credentials or API calls', () => {
    const fetch = mockFetch();
    const sizes = agent37({}).sizes;
    expect(sizes.list().filter((p) => p.status === 'supported').map((p) => p.requested.sizeClass)).toEqual(['md', 'lg']);
    for (const sizeClass of ['xs', 'sm', 'xl', '2xl'] as const) expect(sizes.resolve(sizeClass).status).toBe('unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([['md', 2, 4], ['lg', 4, 8]] as const)('maps %s to resources { cpu: %i, memory: %i }', async (sizeClass, cpu, memory) => {
    const fetch = mockFetch();
    const result = await agent37({ apiKey: 'test' }).instances.create({ sizeClass, templateId: 'agent37-base' });
    const body = JSON.parse((fetch.mock.calls as any[][])[0][1].body);
    expect(body).toEqual({ template: 'agent37-base', resources: { cpu, memory } });
    expect(result.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus: cpu, memoryMiB: memory * 1024 }, provenance: 'adapter-declared' });
  });

  it('applies to performance and vm types, and is unknown for others', async () => {
    const provider = agent37({ apiKey: 'test' });
    expect(provider.sizes.resolve('lg', { type: 'performance' }).status).toBe('supported');
    expect(provider.sizes.resolve('lg', { type: 'vm' }).status).toBe('supported');
    expect(provider.sizes.resolve('lg', { type: 'burstable' }).status).toBe('unknown');
  });

  it('rejects unsupported tiers and native cpu/memory before calling the API', async () => {
    const fetch = mockFetch();
    const provider = agent37({ apiKey: 'test' });
    await expect(provider.instances.create({ sizeClass: 'xl' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(provider.instances.create({ sizeClass: 'md', cpu: 2 })).rejects.toMatchObject({ code: 'conflict' });
    await expect(provider.instances.create({ sizeClass: 'md', memory: 4096 })).rejects.toMatchObject({ code: 'conflict' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

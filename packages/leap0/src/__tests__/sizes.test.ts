/**
 * Leap0 standard size mapping (mock-only: global fetch is stubbed, the real leap0 SDK builds the request).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class maps to vcpu/memory other than its exact profile, or memory is sent in the
 *   wrong unit (Leap0 `memory` is MiB).
 * - Shape below the profile: xl (8 vCPU / 16384 MiB) mapped onto Leap0's 8 vCPU / 8192 MiB ceiling,
 *   or 2xl/3xl claimed when Leap0 caps sandboxes at 8 vCPU / 8192 MiB.
 * - Silent default boot: vcpu/memory dropped on the way to POST /v1/sandbox, so the SDK default
 *   (1 vCPU / 1024 MiB) boots instead; also on the templateId / config.template paths.
 * - Dropped field: `sizeClass` leaking into the wire body, or other create options (envs) lost.
 * - Conflict accepted: sizeClass combined with native `vcpu` or `memory` silently picks one.
 * - Snapshot restore: Leap0 takes compute from the snapshot, so sizeClass + snapshotId must refuse.
 * - Discovery side effects: list()/resolve() calling the API or requiring an API key.
 * - Disk misreported: Leap0's fixed 10 GiB disk missing from `resolved.diskMiB`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leap0 } from '../index';

const supported = [['xs', 1, 1024], ['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192]] as const;

function mockFetch() {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(JSON.stringify({
      id: 'sb-1', template_id: 'tpl-1', template_name: body.template_name, state: 'running',
      vcpu: body.vcpu, memory: body.memory, disk: 10240, created_at: new Date().toISOString(),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function createBody(fetch: ReturnType<typeof mockFetch>) {
  const calls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/v1/sandbox'));
  expect(calls).toHaveLength(1);
  return JSON.parse(String(calls[0][1]!.body));
}

describe('Leap0 standard size mapping', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('discovers sizes without credentials or API calls', () => {
    vi.stubEnv('LEAP0_API_KEY', '');
    const fetch = mockFetch();
    const sizes = leap0({}).sizes;
    expect(sizes.list().filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['xs', 'sm', 'md', 'lg']);
    for (const sizeClass of ['xl', '2xl', '3xl'] as const) {
      const resolution = sizes.resolve(sizeClass);
      expect(resolution.status).toBe('unsupported');
      expect(resolution).toMatchObject({ reason: expect.stringContaining('8192 MiB') });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(supported)('sends %s as exact vcpu/memory to POST /v1/sandbox', async (sizeClass, vcpu, memory) => {
    const fetch = mockFetch();
    const sandbox = await leap0({ apiKey: 'test' }).instances.create({ sizeClass, envs: { A: '1' } });
    const body = createBody(fetch);
    expect(body).toMatchObject({ vcpu, memory, env_vars: { A: '1' } });
    expect(body).not.toHaveProperty('sizeClass');
    expect(sandbox.sizing).toEqual({
      requested: { sizeClass, vcpus: vcpu, memoryMiB: memory },
      resolved: { vcpus: vcpu, memoryMiB: memory, diskMiB: 10240 },
      provenance: 'adapter-declared',
    });
  });

  it('keeps the size on templateId and config.template creates', async () => {
    let fetch = mockFetch();
    await leap0({ apiKey: 'test' }).instances.create({ sizeClass: 'lg', templateId: 'system/debian:bookworm' });
    expect(createBody(fetch)).toMatchObject({ template_name: 'system/debian:bookworm', vcpu: 4, memory: 8192 });
    vi.unstubAllGlobals();
    fetch = mockFetch();
    await leap0({ apiKey: 'test', template: 'my/template' }).instances.create({ sizeClass: 'md' });
    expect(createBody(fetch)).toMatchObject({ template_name: 'my/template', vcpu: 2, memory: 4096 });
  });

  it.each([
    [{ sizeClass: 'sm', vcpu: 1 }, 'conflict'],
    [{ sizeClass: 'sm', memory: 2048 }, 'conflict'],
    [{ sizeClass: 'sm', snapshotId: 'snap' }, 'unsupported'],
    [{ sizeClass: 'xl' }, 'unsupported'],
    [{ sizeClass: '2xl' }, 'unsupported'],
    [{ sizeClass: '3xl' }, 'unsupported'],
    [{ sizeClass: 'huge' }, 'invalid'],
  ])('rejects %j with %s before any API call', async (options, code) => {
    const fetch = mockFetch();
    await expect(leap0({ apiKey: 'test' }).instances.create(options as any)).rejects.toMatchObject({ code, fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves native vcpu/memory untouched without sizeClass', async () => {
    const fetch = mockFetch();
    const sandbox = await leap0({ apiKey: 'test' }).instances.create({ vcpu: 8, memory: 8192 } as any);
    expect(createBody(fetch)).toMatchObject({ vcpu: 8, memory: 8192 });
    expect(sandbox.sizing).toBeUndefined();
  });
});

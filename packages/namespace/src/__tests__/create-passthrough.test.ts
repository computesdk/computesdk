import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

const createdInstance = {
  metadata: { instanceId: 'inst-123' },
  extendedMetadata: { commandServiceEndpoint: 'https://cmd.example.com' },
};

function mockFetch() {
  const calls: Array<{ url: string; body: any }> = [];
  const spy = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => createdInstance,
    } as any;
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

describe('namespace create passthrough', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges containerOptions into the container request', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({
      containerOptions: { nsc_state_path: '/var/run/nsc' },
    } as any);
    const container = calls[0].body.containers[0];
    expect(container.nsc_state_path).toBe('/var/run/nsc');
    expect(container.name).toBe('main-container');
    expect(container.args).toEqual(['sleep', 'infinity']);
  });

  it('merges instanceOptions into the CreateInstance request', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    const permissions = [{ resource: 'instance', action: 'read' }];
    await provider.sandbox.create({
      instanceOptions: { workload_permissions: permissions },
    } as any);
    expect(calls[0].body.workload_permissions).toEqual(permissions);
    expect(calls[0].body.shape.virtual_cpu).toBe(2);
  });

  it('keeps provider-set fields authoritative over passthrough', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({
      image: 'node:22',
      dockerSockPath: '/var/run/docker.sock',
      containerOptions: {
        name: 'other',
        image_ref: 'evil:latest',
        args: ['sh'],
        docker_sock_path: '/tmp/x.sock',
      },
      instanceOptions: { shape: { virtual_cpu: 64 }, containers: [] },
    } as any);
    const body = calls[0].body;
    expect(body.shape.virtual_cpu).toBe(2);
    expect(body.containers).toHaveLength(1);
    expect(body.containers[0].name).toBe('main-container');
    expect(body.containers[0].image_ref).toBe('node:22');
    expect(body.containers[0].args).toEqual(['sleep', 'infinity']);
    expect(body.containers[0].docker_sock_path).toBe('/var/run/docker.sock');
  });

  it('drops passthrough image selectors so the request has exactly one', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({
      containerOptions: { image_ref: 'other:latest', nsc_state_path: '/var/run/nsc' },
    } as any);
    const container = calls[0].body.containers[0];
    expect(container.known_image_id).toBe('builtin:base');
    expect(container).not.toHaveProperty('image_ref');
    expect(container.nsc_state_path).toBe('/var/run/nsc');

    await provider.sandbox.create({
      image: 'node:22',
      containerOptions: { known_image_id: 'builtin:base' },
    } as any);
    expect(calls[1].body.containers[0].image_ref).toBe('node:22');
    expect(calls[1].body.containers[0]).not.toHaveProperty('known_image_id');
  });

  it('ignores non-object passthrough values', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({
      containerOptions: ['nsc_state_path'],
      instanceOptions: 'nope',
    } as any);
    expect(calls[0].body.containers[0]).not.toHaveProperty('0');
    expect(calls[0].body).not.toHaveProperty('0');
  });
});

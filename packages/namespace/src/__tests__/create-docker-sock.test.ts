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

describe('namespace create docker_sock_path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets docker_sock_path on the container when dockerSockPath is passed', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    const { sandboxId } = await provider.sandbox.create({
      dockerSockPath: '/var/run/docker.sock',
    } as any);
    expect(sandboxId).toBe('inst-123');
    expect(calls[0].body.containers[0].docker_sock_path).toBe(
      '/var/run/docker.sock'
    );
  });

  it('omits docker_sock_path when dockerSockPath is not passed', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({} as any);
    expect(calls[0].body.containers[0]).not.toHaveProperty('docker_sock_path');
  });
});

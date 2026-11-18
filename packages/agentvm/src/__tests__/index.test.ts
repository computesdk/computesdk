import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentvm } from '../index';

const spec = {
  provider: 'hetzner',
  region: 'hel1',
  planId: 'test-plan',
  imageId: 'test-image',
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnlyKey example@test',
  maxRuntimeSeconds: 3600,
};

const cfg = () => ({ apiKey: 'test-only', allowBillableCreate: true, machine: { ...spec } });
const ok = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});

afterEach(() => vi.unstubAllGlobals());

describe('AgentVM billable launch authorization', () => {
  it('rejects implicit billable creation before making an API call', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(agentvm({ apiKey: 'test-only', allowBillableCreate: false }).instances.create())
      .rejects.toThrow(/Billable AgentVM creation disabled/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires the real AgentVM plan/image/key contract', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(agentvm({ apiKey: 'test-only', allowBillableCreate: true }).instances.create())
      .rejects.toThrow(/explicit provider, region, planId, imageId/);
    await expect(agentvm({ ...cfg(), machine: { ...spec, planId: '' } }).instances.create())
      .rejects.toThrow(/planId/);
    await expect(agentvm({ ...cfg(), machine: { ...spec, maxRuntimeSeconds: 10 } }).instances.create())
      .rejects.toThrow(/maxRuntimeSeconds/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects generic options that the adapter cannot honor', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(agentvm(cfg()).instances.create({ name: 'ignored' }))
      .rejects.toThrow(/configured explicitly/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('AgentVM HTTP contract (mocked, no billable requests)', () => {
  it('creates a VM with real launch fields and destroys via the action route', async () => {
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/compute/instances')) return ok({ instance: { id: 'vm-test-1', state: 'running', ...spec } });
      if (String(url).endsWith('/compute/instances/vm-test-1/destroy')) return ok({ instance: { id: 'vm-test-1', state: 'destroyed' } });
      throw new Error('unexpected mock route: ' + String(url));
    }));
    const vm = await agentvm(cfg()).instances.create();
    expect(vm.instanceId).toBe('vm-test-1');
    await vm.destroy();
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('https://api.agentvm.sh/v1/compute/instances');
    expect(requests[0].body).toMatchObject(spec);
    expect(requests[1].url).toMatch(/vm-test-1\/destroy$/);
  });

  it('runs an exec operation and returns the required durationMs', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const path = String(url); calls.push(path);
      if (path.endsWith('/compute/instances')) return ok({ instance: { id: 'vm-2', state: 'running', ...spec } });
      if (path.endsWith('/vm-2/operations') && init.method === 'POST') return ok({ operation: { id: 'operation-test' } });
      if (path.endsWith('/vm-2/operations/operation-test')) return ok({ operation: { status: 'completed', result: { stdout: 'hello\n', stderr: '', exitCode: 0 } } });
      throw new Error('unexpected mock route: '+path);
    }));
    const vm = await agentvm(cfg()).instances.create();
    const result = await vm.runCommand('echo hello');
    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(calls.some(c => c.endsWith('/vm-2/operations/operation-test'))).toBe(true);
  });

  it('returns AgentVM instance lifetime in milliseconds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/compute/instances')) return ok({ instance: { id: 'vm-3', state: 'running', ...spec } });
      if (String(url).endsWith('/vm-3')) return ok({ instance: { id: 'vm-3', state: 'running', createdAt: '2026-11-18T00:00:00Z', maxRuntimeSeconds: 3600 } });
      throw new Error('unexpected mock route');
    }));
    const vm = await agentvm(cfg()).instances.create();
    const info = await vm.getInfo();
    expect(info.provider).toBe('agentvm');
    expect(info.status).toBe('running');
    expect(info.timeout).toBe(3_600_000);
  });
});

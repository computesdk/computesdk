import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
const get = vi.fn();
const org = vi.fn();
const client = vi.fn();
const resolveInstanceId = vi.fn();
vi.mock('../actions.js', async (original) => ({
  ...await original<typeof import('../actions.js')>(),
  client: (...args: unknown[]) => client(...args),
}));
vi.mock('../current-instance.js', () => ({ resolveInstanceId: (...args: unknown[]) => resolveInstanceId(...args) }));
const { getStatus, registerStatusCommand } = await import('../status.js');
const organization = { organizationId: 'o1', slug: 'team', name: 'Team' };
const sandboxId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
beforeEach(() => {
  vi.resetAllMocks();
  client.mockResolvedValue({ get, org });
  org.mockResolvedValue(organization);
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/balance')) return { balanceMicroUsd: 12500000, heldMicroUsd: 500000 };
    if (path.endsWith('/quote')) return { quote: { ok: true } };
    return { sandbox: { id: sandboxId, status: 'running', provider: 'e2b' } };
  });
});
afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });

describe('compute status', () => {
  it('reports the effective org, credits, selected sandbox, and a read-only routing check', async () => {
    resolveInstanceId.mockReturnValue({ id: sandboxId, source: 'env' });
    expect(await getStatus({ org: 'team', apiKey: 'explicit' })).toEqual({
      authenticated: true, ready: true, organization,
      credits: { balanceUsd: 12.5, heldUsd: 0.5 },
      sandbox: { id: sandboxId, status: 'running', provider: 'e2b' },
      routing: { ready: true }, issues: [],
    });
    expect(client).toHaveBeenCalledWith({ org: 'team', apiKey: 'explicit' });
    expect(resolveInstanceId).toHaveBeenCalledWith(undefined, { org: 'team', apiKey: 'explicit' });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/billing/balance', '/api/v1/sandboxes/quote', `/api/v1/sandboxes/${sandboxId}`,
    ]);
  });

  it('requires no selected sandbox for readiness and exposes placement refusals', async () => {
    get.mockImplementation(async (path: string) => path.endsWith('/quote')
      ? { quote: { ok: false, reason: 'insufficient_credits' } }
      : { balanceMicroUsd: 0, heldMicroUsd: 0 });
    expect(await getStatus({})).toMatchObject({ authenticated: true, ready: false, sandbox: null, routing: { ready: false, reason: 'insufficient_credits' } });
  });

  it('retains successful diagnostics when another endpoint fails', async () => {
    resolveInstanceId.mockReturnValue({ id: sandboxId, source: 'file' });
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/quote')) return { quote: { ok: true } };
      throw new Error('service unavailable');
    });
    const status = await getStatus({});
    expect(status).toMatchObject({ authenticated: true, organization, routing: { ready: true }, credits: null, sandbox: { id: sandboxId, status: 'unknown' } });
    expect(status.issues).toEqual(['Credits: service unavailable', 'Selected sandbox: service unavailable']);
  });

  it('returns actionable unsigned-in diagnostics and --check fails without noisy JSON', async () => {
    client.mockRejectedValue(new Error('Run compute login'));
    const program = new Command();
    registerStatusCommand(program);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await program.parseAsync(['status', '--check', '--json'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(write.mock.calls.map(([s]) => String(s)).join(''))).toMatchObject({ authenticated: false, ready: false, issues: ['Run compute login'] });
  });

  it('--check succeeds when authenticated and routing is ready', async () => {
    const program = new Command();
    registerStatusCommand(program);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['status', '--check'], { from: 'user' });
    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('Organization: team');
  });
});

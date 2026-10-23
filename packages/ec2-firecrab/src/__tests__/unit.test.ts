import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ec2Firecrab } from '../index';

const mocks = vi.hoisted(() => ({ runSshCommand: vi.fn() }));
vi.mock('../ssh.js', () => ({ runSshCommand: mocks.runSshCommand }));
const runSshCommandMock = mocks.runSshCommand;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ec2Firecrab', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a provider factory named ec2-firecrab', () => {
    const provider = ec2Firecrab({ apiUrl: 'http://127.0.0.1:5523', microNetworkId: 'net-1' });
    expect(provider).toBeTruthy();
  });

  it('creates and starts a microVM through the firecrab REST API', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'vm-1' }, 201)) // POST /api/vms
      .mockResolvedValueOnce(jsonResponse({}, 200)) // POST /api/vms/vm-1/start
      .mockResolvedValueOnce(
        jsonResponse({ id: 'vm-1', name: 'csdk-fc-x', state: 'running', ipv4: '10.0.0.2' }),
      ); // GET /api/vms/vm-1

    const provider = ec2Firecrab({
      apiUrl: 'http://127.0.0.1:5523',
      microNetworkId: 'net-1',
    });
    const instance = await provider.instances.create();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('http://127.0.0.1:5523/api/vms');
    expect(JSON.parse(createInit.body).microNetworkId).toBe('net-1');
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:5523/api/vms/vm-1/start');
    expect((instance as any).instanceId).toBe('vm-1');
  });

  it('execs commands over the per-VM ssh key + guest sshd', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'vm-1' }, 201)) // POST /api/vms
      .mockResolvedValueOnce(jsonResponse({}, 200)) // POST /api/vms/vm-1/start
      .mockResolvedValueOnce(
        jsonResponse({ id: 'vm-1', name: 'csdk-fc-x', state: 'running', ipv4: '10.0.0.2' }),
      ) // GET /api/vms/vm-1
      .mockResolvedValueOnce(new Response('-----BEGIN OPENSSH PRIVATE KEY-----\nX\n')); // GET ssh-key
    runSshCommandMock.mockResolvedValueOnce({ stdout: 'hi\n', stderr: '', exitCode: 0, durationMs: 12 });

    const provider = ec2Firecrab({
      apiUrl: 'http://127.0.0.1:5523',
      microNetworkId: 'net-1',
      sshProxyCommand: 'ssh -W %h:%p ubuntu@host',
    });
    const instance = await provider.instances.create();
    const result = await instance.runCommand('echo hi');

    expect(fetchMock.mock.calls[3][0]).toBe('http://127.0.0.1:5523/api/vms/vm-1/ssh-key');
    expect(runSshCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '10.0.0.2',
        user: 'root',
        identityPem: expect.stringContaining('OPENSSH PRIVATE KEY'),
        proxyCommand: 'ssh -W %h:%p ubuntu@host',
        command: 'echo hi',
      }),
    );
    expect(result.stdout).toBe('hi\n');
  });

  it('getById tries every configured host until the VM is found', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([])) // tunnel probe, host A
      .mockResolvedValueOnce(jsonResponse([])) // tunnel probe, host B
      .mockResolvedValueOnce(new Response('not found', { status: 404 })) // getVm, host A: miss
      .mockResolvedValueOnce(
        jsonResponse({ id: 'vm-9', name: 'csdk-fc-y', state: 'running', ipv4: '10.0.0.7' }),
      ); // getVm, host B: hit

    const provider = ec2Firecrab({
      microNetworkId: 'net-1',
      sshTargets: ['ubuntu@host-a', 'ubuntu@host-b'],
      sshIdentityPath: '/tmp/nope-key',
    });
    const found = await provider.instances.getById('vm-9');
    expect(found).toBeTruthy();
    expect((found as any).instance.apiUrl).toContain('127.0.0.1');
  });

  it('list merges sandboxes across all configured hosts', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([])) // tunnel probe, host A
      .mockResolvedValueOnce(jsonResponse([])) // tunnel probe, host B
      .mockResolvedValueOnce(jsonResponse([{ id: 'vm-a', name: 'csdk-fc-a', state: 'running' }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'vm-b', name: 'csdk-fc-b', state: 'running' }]));

    const provider = ec2Firecrab({
      microNetworkId: 'net-1',
      sshTargets: ['ubuntu@host-a', 'ubuntu@host-b'],
      sshIdentityPath: '/tmp/nope-key-2',
    });
    const all = await provider.instances.list();
    expect(all.map((i: any) => i.instanceId).sort()).toEqual(['vm-a', 'vm-b']);
  });
});

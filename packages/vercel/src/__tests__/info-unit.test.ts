import { describe, it, expect, vi } from 'vitest';
import { vercel } from '../index';

const createdAt = new Date('2026-01-02T03:04:05Z');
const sandboxState = vi.hoisted(() => ({ status: 'running' as string }));

vi.mock('@vercel/sandbox', () => {
  const mockSandboxInstance = {
    name: 'sbx-real-name',
    get status() { return sandboxState.status; },
    createdAt: new Date('2026-01-02T03:04:05Z'),
    timeout: 600000,
    stop: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Sandbox: {
      create: vi.fn().mockResolvedValue(mockSandboxInstance),
      get: vi.fn().mockResolvedValue(mockSandboxInstance),
    },
    Snapshot: { get: vi.fn() },
  };
});

describe('Vercel getInfo', () => {
  const provider = vercel({ token: 't', teamId: 'team', projectId: 'proj' });

  it('reports the sandbox name, creation time and timeout', async () => {
    sandboxState.status = 'running';
    const sandbox = await provider.sandbox.create();
    const info = await sandbox.getInfo();
    expect(info).toMatchObject({ id: 'sbx-real-name', provider: 'vercel', status: 'running', timeout: 600000 });
    expect(info.createdAt).toEqual(createdAt);
  });

  it('maps stopped and failed sessions', async () => {
    const sandbox = await provider.sandbox.create();
    sandboxState.status = 'stopped';
    expect((await sandbox.getInfo()).status).toBe('stopped');
    sandboxState.status = 'failed';
    expect((await sandbox.getInfo()).status).toBe('error');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('../actions.js', async original => ({ ...await original<typeof import('../actions.js')>(), client: async () => api }));
import { registerDiskCommands } from '../disks.js';
const id = '11111111-1111-4111-8111-111111111111';
function program() { const p = new Command().exitOverride(); registerDiskCommands(p); return p; }
describe('retained disks CLI', () => {
  beforeEach(() => { vi.clearAllMocks(); api.post.mockResolvedValue({ disk: { id } }); api.get.mockResolvedValue({ disk: { id } }); api.del.mockResolvedValue({ disk: { id } }); });
  it('keeps storage placement and retry identity independent of compute', async () => {
    await program().parseAsync(['disks', 'create', '--region', 'aws-us-east-1', '--provider', 'namespace', '--idempotency-key', 'migration-1', '--json'], { from: 'user' });
    expect(api.post).toHaveBeenCalledWith('/api/v1/disks', { region: 'aws-us-east-1', provider: 'namespace', idempotencyKey: 'migration-1', computeRegion: undefined });
    await program().parseAsync(['disks', 'get', id, '--json'], { from: 'user' });
    await program().parseAsync(['disks', 'delete', id, '--json'], { from: 'user' });
    expect(api.get).toHaveBeenCalledWith(`/api/v1/disks/${id}`);
    expect(api.del).toHaveBeenCalledWith(`/api/v1/disks/${id}`);
  });
});

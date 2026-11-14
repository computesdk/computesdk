import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('../actions.js', async original => ({ ...await original<typeof import('../actions.js')>(), client: async () => api }));
import { registerDiskCommands } from '../disks.js';
const id = '11111111-1111-4111-8111-111111111111';
function program() { const p = new Command().exitOverride(); registerDiskCommands(p); return p; }
describe('retained disks CLI', () => {
  beforeEach(() => { vi.clearAllMocks(); api.post.mockResolvedValue({ disk: { id } }); api.get.mockResolvedValue({ disk: { id } }); api.del.mockResolvedValue({ disk: { id } }); });
  it('neutralizes terminal controls in human output from disk APIs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      api.post.mockResolvedValueOnce({ disk: { id: '\u001b]52;c;payload\u0007bad\u009b31m' } });
      await program().parseAsync(['disks', 'create', '--idempotency-key', 'safe'], { from: 'user' });
      api.get.mockResolvedValueOnce({ disk: { region: 'bad\u009b31m' } });
      await program().parseAsync(['disks', 'get', id], { from: 'user' });
      // eslint-disable-next-line no-control-regex
      for (const [text] of log.mock.calls) expect(String(text)).not.toMatch(/[\u001b\u0007\u009b]/u);
    } finally { log.mockRestore(); }
  });
  it('keeps storage placement and retry identity independent of compute', async () => {
    await program().parseAsync(['disks', 'create', '--region', 'aws-us-east-1', '--provider', 'namespace', '--idempotency-key', 'migration-1', '--json'], { from: 'user' });
    expect(api.post).toHaveBeenCalledWith('/api/v1/disks', { region: 'aws-us-east-1', provider: 'namespace', idempotencyKey: 'migration-1', computeRegion: undefined });
    await program().parseAsync(['disks', 'get', id, '--json'], { from: 'user' });
    await program().parseAsync(['disks', 'delete', id, '--json'], { from: 'user' });
    expect(api.get).toHaveBeenCalledWith(`/api/v1/disks/${id}`);
    expect(api.del).toHaveBeenCalledWith(`/api/v1/disks/${id}`);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { PlatformApiError } from '@computesdk/platform';
const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('../actions.js', async original => ({ ...await original<typeof import('../actions.js')>(), client: async () => api }));
import { registerDiskCommands } from '../disks.js';
const id = '11111111-1111-4111-8111-111111111111';
function program() { const p = new Command().exitOverride(); registerDiskCommands(p); return p; }
describe('retained disks CLI', () => {
  beforeEach(() => { vi.clearAllMocks(); api.post.mockResolvedValue({ disk: { id } }); api.get.mockResolvedValue({ disk: { id } }); api.del.mockResolvedValue({ disk: { id } }); });
  it('preserves API status, retryability and details in JSON create failures', async () => {
    const error = new PlatformApiError(503, 'temporarily unavailable', { details: { diskId: id } });
    api.post.mockRejectedValueOnce(error);
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await expect(program().parseAsync(['disks', 'create', '--idempotency-key', 'retry-me', '--json'], { from: 'user' })).rejects.toThrow('exit');
      const envelope = JSON.parse(write.mock.calls.map(c => String(c[0])).join(''));
      expect(envelope.error).toMatchObject({ httpStatus: 503, retryable: true, details: { diskId: id } });
      expect(envelope.error.message).toContain('--idempotency-key retry-me');
    } finally { write.mockRestore(); exit.mockRestore(); }
  });
  it('emits structured usage errors for missing IDs and unknown flags', () => {
    for (const args of [['get', '--json'], ['get', id, '--unknown', '--json']]) {
      const result = spawnSync(process.execPath, ['dist/index.js', 'disks', ...args], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe('invalid_argument');
    }
  });
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

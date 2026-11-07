import { Arker, ArkerError, type SyncChunkWrite, type VM } from '@arker-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arker } from '../index';

const chunkBytes = 3 * 256 * 1024;

async function fixture(streamMissing = false) {
  const sync = vi.fn(async () => {
    if (streamMissing) throw new ArkerError('not_found', 'The route was not found.', 404);
  });
  const request = vi.fn(async (_method: string, _path: string, body: { op: 'write'; writes: SyncChunkWrite[] }, _baseUrl: string) => ({
    ok: true,
    results: body.writes.map((entry: { end: number; size: number }) => ({
      complete: entry.end === entry.size, written: entry.end === entry.size,
    })),
  }));
  const run = vi.fn(async (_command: string) => ({ stdout: '/home/user/project\n', stderr: '', exitCode: 0, state: 'completed' }));
  const vm = { id: 'vm-transfer', baseUrl: 'https://example.arker.ai/api', sync, run, _client: { _request: request } };
  vi.spyOn(Arker.prototype, 'fork').mockResolvedValue(vm as unknown as VM);
  const box = await arker({ apiKey: 'ark_test' }).instances.create();
  return { box, sync, request, run };
}

describe('Arker native filesystem writes', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(['', 'hello\n世界\u0000', 'x'.repeat(chunkBytes + 3)])('writes bytes through native sync without a payload-bearing command', async (content) => {
    const { box, sync, request, run } = await fixture();
    await box.filesystem.writeFile('/root/file', content);
    expect(sync).toHaveBeenCalledWith('/root/file', Buffer.from(content));
    expect(run).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('resolves relative paths using the actual guest working directory without shell interpolation', async () => {
    const { box, sync, run } = await fixture();
    await box.filesystem.writeFile("nested/file ' $(touch bad)\n.txt", 'data');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('pwd -P');
    expect(sync).toHaveBeenCalledWith("/home/user/project/nested/file ' $(touch bad)\n.txt", Buffer.from('data'));
  });

  it('preserves a working directory ending in a newline', async () => {
    const { box, sync, run } = await fixture();
    run.mockResolvedValue({ stdout: '/root/newline\n\n', stderr: '', exitCode: 0, state: 'completed' });
    await box.filesystem.writeFile('file', 'data');
    expect(sync).toHaveBeenCalledWith('/root/newline\n/file', Buffer.from('data'));
  });

  it.each(['', 'hello\n世界\u0000', 'x'.repeat(chunkBytes * 2) + '世界'])('falls back to bounded native chunks, including empty and multibyte files', async (content) => {
    const { box, sync, request, run } = await fixture(true);
    await box.filesystem.writeFile('/root/file', content);
    const chunks = request.mock.calls.map(([method, path, body, baseUrl]) => {
      expect(method).toBe('POST');
      expect(path).toBe('/v1/vms/vm-transfer/sync');
      expect(baseUrl).toBe('https://example.arker.ai/api');
      expect(body.op).toBe('write');
      expect(body.writes).toHaveLength(1);
      return body.writes[0];
    });
    expect(chunks.length).toBe(Math.max(1, Math.ceil(Buffer.byteLength(content) / chunkBytes)));
    expect(new Set(chunks.map((chunk) => chunk.upload_id)).size).toBe(1);
    let offset = 0;
    for (const chunk of chunks) {
      expect(chunk).toMatchObject({ path: '/root/file', size: Buffer.byteLength(content), start: offset });
      const decoded = Buffer.from(chunk.content, 'base64');
      expect(decoded.length).toBeLessThanOrEqual(chunkBytes);
      offset += decoded.length;
      expect(chunk.end).toBe(offset);
    }
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.content, 'base64')))).toEqual(Buffer.from(content));
    expect(run).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('uses different upload IDs for concurrent writes', async () => {
    const { box, request } = await fixture(true);
    await Promise.all([box.filesystem.writeFile('/root/a', 'a'), box.filesystem.writeFile('/root/b', 'b')]);
    expect(new Set(request.mock.calls.map((call) => call[2].writes[0].upload_id)).size).toBe(2);
  });

  it.each([
    { ok: false, results: [] },
    { ok: true, results: [] },
    { ok: true, results: [{ error: { message: 'disk full' } }] },
    { ok: true, results: [{ complete: false, written: false }] },
    { ok: true, results: [{ complete: true, written: false }] },
  ])('rejects unsuccessful or incomplete native commits: %j', async (response) => {
    const { box, request, run } = await fixture(true);
    request.mockResolvedValue(response as unknown as Awaited<ReturnType<typeof request>>);
    await expect(box.filesystem.writeFile('/root/file', 'payload')).rejects.toThrow('Arker writeFile failed');
    expect(run).not.toHaveBeenCalled();
  });

  it('does not hide authorization or transport failures with a shell fallback', async () => {
    const { box, sync, request, run } = await fixture();
    sync.mockRejectedValue(new ArkerError('forbidden', 'denied', 403));
    await expect(box.filesystem.writeFile('/root/file', 'data')).rejects.toThrow('denied');
    expect(request).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects failed cwd resolution before sending file content', async () => {
    const { box, sync, request, run } = await fixture();
    run.mockResolvedValue({ stdout: '', stderr: 'no cwd', exitCode: 1, state: 'failed' });
    await expect(box.filesystem.writeFile('relative', 'data')).rejects.toThrow('no cwd');
    expect(sync).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});

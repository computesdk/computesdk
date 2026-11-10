import { beforeEach, describe, expect, it, vi } from 'vitest';

const { putMock, getMock, listMock, removeMock, headMock } = vi.hoisted(() => ({
  putMock: vi.fn(),
  getMock: vi.fn(),
  listMock: vi.fn(),
  removeMock: vi.fn(),
  headMock: vi.fn(),
}));

vi.mock('@tigrisdata/storage', () => ({
  put: putMock,
  get: getMock,
  list: listMock,
  remove: removeMock,
  head: headMock,
}));

import { r2 } from '../index';

describe('r2 config forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({ data: {}, error: null });
    getMock.mockResolvedValue({ data: new ReadableStream({ start: (c) => c.close() }), error: null });
    listMock.mockResolvedValue({ data: { objects: [] }, error: null });
    removeMock.mockResolvedValue({ data: {}, error: null });
    headMock.mockResolvedValue({ data: {}, error: null });
  });

  it('forwards endpoint, credentials, and bucket via per-call config', async () => {
    const provider = r2({
      accessKeyId: 'r2-akid',
      secretAccessKey: 'r2-secret',
      endpoint: 'https://account.r2.cloudflarestorage.com',
    });

    await provider.upload('bucket-a', 'hello.txt', 'hello');
    await provider.download('bucket-b', 'file.txt');
    await provider.list('bucket-c', { prefix: 'x/' });
    await provider.delete('bucket-d', 'to-delete.txt');

    expect(putMock).toHaveBeenCalledWith(
      'hello.txt',
      'hello',
      expect.objectContaining({
        config: expect.objectContaining({
          accessKeyId: 'r2-akid',
          secretAccessKey: 'r2-secret',
          endpoint: 'https://account.r2.cloudflarestorage.com',
          bucket: 'bucket-a',
        }),
      })
    );

    expect(getMock).toHaveBeenCalledWith(
      'file.txt',
      'stream',
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'bucket-b' }),
      })
    );

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'bucket-c' }),
      })
    );

    expect(removeMock).toHaveBeenCalledWith(
      'to-delete.txt',
      expect.objectContaining({
        config: expect.objectContaining({ bucket: 'bucket-d' }),
      })
    );
  });

  it('maps the storage SDK list response and forwards the continuation token', async () => {
    const lastModified = new Date('2026-01-01T00:00:00Z');
    listMock.mockResolvedValue({
      data: {
        items: [{ id: 'p/a.txt', name: 'p/a.txt', size: 3, lastModified }],
        commonPrefixes: [],
        paginationToken: 'next-token',
        hasMore: true,
      },
      error: null,
    });
    const provider = r2({
      accessKeyId: 'r2-akid',
      secretAccessKey: 'r2-secret',
      endpoint: 'https://account.r2.cloudflarestorage.com',
    });

    const result = await provider.list('bucket-e', { prefix: 'p/', maxKeys: 1, continuationToken: 'prev-token' });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'p/', limit: 1, paginationToken: 'prev-token' })
    );
    expect(result).toEqual({
      objects: [{ bucket: 'bucket-e', key: 'p/a.txt', size: 3, lastModified }],
      truncated: true,
      continuationToken: 'next-token',
    });
  });
});

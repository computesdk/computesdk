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

import { s3 } from '../index';

describe('s3 config forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({ data: {}, error: null });
    getMock.mockImplementation(async () => ({ data: new ReadableStream({ start: (c) => c.close() }), error: null }));
    listMock.mockResolvedValue({ data: { items: [], commonPrefixes: [], paginationToken: undefined, hasMore: false }, error: null });
    removeMock.mockResolvedValue({ data: {}, error: null });
    headMock.mockResolvedValue({ data: {}, error: null });
  });

  it('forwards endpoint, credentials, and bucket via per-call config', async () => {
    const provider = s3({
      accessKeyId: 'akid',
      secretAccessKey: 'secret',
      endpoint: 'https://example-s3.local',
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
          accessKeyId: 'akid',
          secretAccessKey: 'secret',
          endpoint: 'https://example-s3.local',
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

  it('defaults the endpoint to Tigris when none is configured', async () => {
    const previous = process.env.TIGRIS_STORAGE_ENDPOINT;
    delete process.env.TIGRIS_STORAGE_ENDPOINT;
    try {
      const provider = s3({ accessKeyId: 'akid', secretAccessKey: 'secret' });
      await provider.upload('bucket-a', 'hello.txt', 'hello');
      expect(putMock).toHaveBeenCalledWith(
        'hello.txt',
        'hello',
        expect.objectContaining({
          config: expect.objectContaining({ endpoint: 'https://t3.storage.dev' }),
        })
      );
    } finally {
      if (previous !== undefined) process.env.TIGRIS_STORAGE_ENDPOINT = previous;
    }
  });

  it('maps Tigris list items and pagination to ListResult', async () => {
    const modified = new Date('2026-01-01T00:00:00Z');
    listMock.mockResolvedValueOnce({
      data: {
        items: [{ id: 'a', name: 'x/a.txt', size: 3, lastModified: modified }],
        commonPrefixes: [],
        paginationToken: 'next-page',
        hasMore: true,
      },
      error: null,
    });
    const provider = s3({ accessKeyId: 'akid', secretAccessKey: 'secret', endpoint: 'https://example-s3.local' });

    const result = await provider.list('bucket-c', { prefix: 'x/', maxKeys: 1, continuationToken: 'page-1' });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'x/', limit: 1, paginationToken: 'page-1' })
    );
    expect(result).toEqual({
      objects: [{ bucket: 'bucket-c', key: 'x/a.txt', size: 3, lastModified: modified }],
      truncated: true,
      continuationToken: 'next-page',
    });
  });
});

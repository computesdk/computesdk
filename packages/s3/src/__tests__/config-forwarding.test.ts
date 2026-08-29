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
    getMock.mockResolvedValue({ data: new ReadableStream(), error: null });
    listMock.mockResolvedValue({ data: { objects: [] }, error: null });
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
});

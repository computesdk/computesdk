import { describe, it, expect, vi } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { asciiBox } from '../index';
import { BoxApi, Configuration } from '@asciidev/box-sdk';

vi.mock('@asciidev/box-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@asciidev/box-sdk')>();

  const createMock = vi.fn().mockResolvedValue({
    box: { id: 'box-123', state: 'Ready', name: 'test-box', desktopAvailable: false },
  });
  const getMock = vi.fn().mockResolvedValue({
    box: { id: 'box-123', state: 'Ready', name: 'test-box', desktopAvailable: false },
  });
  const boxesMock = vi.fn().mockResolvedValue({ boxes: [], pageInfo: { hasMore: false } });
  const hostPortMock = vi.fn().mockResolvedValue({ url: 'https://box-123-8080.ascii.dev' });
  const waitUntilReadyMock = vi.fn().mockResolvedValue({
    id: 'box-123',
    state: 'Ready',
    name: 'test-box',
    desktopAvailable: false,
  });
  const stopAndRemoveMock = vi.fn().mockResolvedValue(undefined);
  const readTextMock = vi.fn().mockResolvedValue('hello');
  const writeTextMock = vi.fn().mockResolvedValue(undefined);
  const execCommandMock = vi.fn().mockImplementation(async (_api, _id, command: string) => {
    if (command.includes('ls -la')) {
      return {
        stdout:
          'total 0\n' +
          '-rw-r--r-- 1 user group 12 Sep  1 10:00 file -> real.txt\n' +
          'drwxr-xr-x 1 user group  0 Sep  2  2024 mydir\n' +
          'lrwxrwxrwx 1 user group  4 Sep  1 10:00 link -> target\n',
        stderr: '',
        exitCode: 0,
      };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  return {
    ...original,
    BoxApi: vi.fn().mockImplementation(() => ({
      create: createMock,
      get: getMock,
      boxes: boxesMock,
      hostPort: hostPortMock,
    })),
    Configuration: vi.fn(),
    waitUntilReady: waitUntilReadyMock,
    execCommand: execCommandMock,
    readText: readTextMock,
    writeText: writeTextMock,
    stopAndRemove: stopAndRemoveMock,
  };
});

runProviderTestSuite({
  name: 'asciibox',
  provider: asciiBox({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  skipIntegration: !process.env.ASCIIBOX_API_KEY,
  ports: [3000, 8080],
});

describe('asciiBox SDK mapping', () => {
  it('maps create options to the ASCII Box create request', async () => {
    const provider = asciiBox({ apiKey: 'test-key', type: 'large' });
    const sandbox = await provider.sandbox.create({
      templateId: 'my-env',
      snapshotId: 'my-snap',
      envs: { FOO: 'bar' },
      timeout: 120000,
    });

    const instance = sandbox.getInstance() as any;
    expect(instance.api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        createBoxRequest: expect.objectContaining({
          type: 'large',
          ttlSeconds: 120,
          environment: 'my-env',
          env: { FOO: 'bar' },
          from: 'my-snap',
        }),
      })
    );
  });

  it('paginates list calls using pageInfo cursor', async () => {
    const shared = new (BoxApi as any)(new (Configuration as any)()) as any;
    shared.boxes
      .mockResolvedValueOnce({
        boxes: [
          { id: 'box-1', state: 'Ready', name: 'one', desktopAvailable: false },
        ],
        pageInfo: { hasMore: true, nextCursor: 'cursor-1' },
      })
      .mockResolvedValueOnce({
        boxes: [
          { id: 'box-2', state: 'Ready', name: 'two', desktopAvailable: false },
        ],
        pageInfo: { hasMore: false },
      });

    const provider = asciiBox({ apiKey: 'test-key' });
    const result = await provider.sandbox.list();

    expect(result).toHaveLength(2);
    expect(result[0].sandboxId).toBe('box-1');
    expect(result[1].sandboxId).toBe('box-2');
    expect(shared.boxes).toHaveBeenCalledTimes(2);
  });

  it('parses ls output and handles symlinks', async () => {
    const provider = asciiBox({ apiKey: 'test-key' });
    const sandbox = await provider.sandbox.create({});

    const entries = await sandbox.filesystem.readdir('/tmp');

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['file -> real.txt', 'link', 'mydir']);

    const link = entries.find((e) => e.name === 'link');
    expect(link).toBeDefined();
    expect(link?.type).toBe('file');
  });
});

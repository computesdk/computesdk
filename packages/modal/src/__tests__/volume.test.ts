import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVolumeService, mockImage, mockApp, MockVolume, mockSandboxes } = vi.hoisted(() => {
  class MockVolume {
    volumeId: string;
    name?: string;
    private mountOptions: Record<string, any>;

    constructor(volumeId: string, name?: string, mountOptions?: Record<string, any>) {
      this.volumeId = volumeId;
      this.name = name;
      this.mountOptions = mountOptions ?? {};
    }

    withMountOptions(options: Record<string, any>): this {
      this.mountOptions = { ...this.mountOptions, ...options };
      return this;
    }

    get isReadOnly(): boolean {
      return !!this.mountOptions.readOnly;
    }
  }

  const mockFromName = vi.fn();
  const mockDelete = vi.fn();
  const mockApp = { appId: 'app-123', name: 'computesdk-modal' };
  const mockImage = {
    imageId: 'img-123',
    build: vi.fn().mockResolvedValue({ imageId: 'img-built' }),
  };
  const mockSandboxesCreate = vi.fn().mockResolvedValue({ sandboxId: 'sb-123', terminate: vi.fn() });

  return {
    mockVolumeService: { fromName: mockFromName, delete: mockDelete },
    mockImage,
    mockApp,
    MockVolume,
    mockSandboxes: { create: mockSandboxesCreate },
  };
});

vi.mock('modal', () => ({
  ModalClient: class MockModalClient {
    apps = {
      fromName: vi.fn().mockResolvedValue(mockApp),
    };
    images = {
      fromRegistry: vi.fn().mockReturnValue(mockImage),
      fromId: vi.fn().mockRejectedValue(new Error('not found')),
    };
    sandboxes = mockSandboxes;
    volumes = mockVolumeService;
  },
  Volume: MockVolume,
}));

import { modal } from '../index';

describe('Modal volume manager', () => {
  beforeEach(() => {
    mockVolumeService.fromName.mockReset();
    mockVolumeService.delete.mockReset();
    mockImage.build.mockReset();
    mockImage.build.mockResolvedValue({ imageId: 'img-built' });
    mockSandboxes.create.mockReset();
    mockSandboxes.create.mockResolvedValue({ sandboxId: 'sb-123', terminate: vi.fn() });
  });

  it('create returns a volume whose stable id is its name', async () => {
    mockVolumeService.fromName.mockResolvedValue(new MockVolume('vol-id-abc', 'my-volume'));

    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const volume = await provider.volume?.create({ name: 'my-volume' });

    expect(volume).toBeDefined();
    expect(volume!.id).toBe('my-volume');
    expect(volume!.name).toBe('my-volume');
    expect(volume!.metadata).toMatchObject({ volumeId: 'vol-id-abc' });
    expect(mockVolumeService.fromName).toHaveBeenCalledWith('my-volume', { createIfMissing: true });
  });

  it('getById resolves by name and preserves stable id', async () => {
    mockVolumeService.fromName.mockResolvedValue(new MockVolume('vol-id-xyz', 'other-volume'));

    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const volume = await provider.volume?.getById('other-volume');

    expect(volume).toBeDefined();
    expect(volume!.id).toBe('other-volume');
    expect(mockVolumeService.fromName).toHaveBeenCalledWith('other-volume', { createIfMissing: false });
  });

  it('delete passes the stable name and allows missing', async () => {
    mockVolumeService.delete.mockResolvedValue(undefined);

    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    await provider.volume?.delete('my-volume');

    expect(mockVolumeService.delete).toHaveBeenCalledWith('my-volume', { allowMissing: true });
  });

  it('sandbox.create resolves existing volumeIds with createIfMissing false', async () => {
    mockVolumeService.fromName.mockResolvedValue(new MockVolume('vol-id-1', 'vol-one'));

    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create({ volumeIds: ['vol-one'] });

    expect(sandbox.sandboxId).toBe('sb-123');
    expect(mockVolumeService.fromName).toHaveBeenCalledWith('vol-one', { createIfMissing: false });
  });

  it('create uses a unique default name when none is supplied', async () => {
    mockVolumeService.fromName.mockImplementation((name: string) =>
      Promise.resolve(new MockVolume('vol-id-' + name, name))
    );

    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const volumeA = await provider.volume?.create({});
    const volumeB = await provider.volume?.create({});

    expect(volumeA!.id).toMatch(/^computesdk-volume-[0-9a-f-]{36}$/i);
    expect(volumeB!.id).toMatch(/^computesdk-volume-[0-9a-f-]{36}$/i);
    expect(volumeA!.id).not.toBe(volumeB!.id);
  });
});

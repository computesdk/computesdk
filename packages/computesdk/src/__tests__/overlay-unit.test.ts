import { describe, it, expect, vi } from 'vitest';
import { Overlay, OverlayResponse, CreateOverlayOptions } from '../client/resources/overlay';

describe('Overlay Resource', () => {
  const mockCreate = vi.fn();
  const mockList = vi.fn();
  const mockRetrieve = vi.fn();
  const mockDestroy = vi.fn();

  const overlay = new Overlay({
    create: mockCreate,
    list: mockList,
    retrieve: mockRetrieve,
    destroy: mockDestroy,
  });

  const baseResponse: OverlayResponse = {
    id: 'ov-123',
    source: '/src',
    target: 'dest',
    created_at: '2023-01-01T00:00:00Z',
    stats: {
      copied_files: 10,
      copied_dirs: 2,
      skipped: [],
    },
    copy_status: 'complete',
  };

  it('create() passes strategy to handler', async () => {
    mockCreate.mockResolvedValue({
      ...baseResponse,
      strategy: 'smart',
    });

    const options: CreateOverlayOptions = {
      source: '/src',
      target: 'dest',
      strategy: 'smart',
    };

    await overlay.create(options);

    expect(mockCreate).toHaveBeenCalledWith(options);
  });

  it('create() returns OverlayInfo with correct strategy (smart)', async () => {
    mockCreate.mockResolvedValue({
      ...baseResponse,
      strategy: 'smart',
    });

    const result = await overlay.create({ source: '/src', target: 'dest' });

    expect(result.strategy).toBe('smart');
  });

  it('create() returns OverlayInfo with correct strategy (copy)', async () => {
    mockCreate.mockResolvedValue({
      ...baseResponse,
      strategy: 'copy',
    });

    const result = await overlay.create({ source: '/src', target: 'dest' });

    expect(result.strategy).toBe('copy');
  });

  it('create() defaults strategy to "copy" if missing in response', async () => {
    // Simulate old server response
    mockCreate.mockResolvedValue({
      ...baseResponse,
      strategy: undefined,
    });

    const result = await overlay.create({ source: '/src', target: 'dest' });

    expect(result.strategy).toBe('copy');
  });

  it('retrieve() handles strategy correctly', async () => {
    mockRetrieve.mockResolvedValue({
      ...baseResponse,
      strategy: 'smart',
    });

    const result = await overlay.retrieve('ov-123');

    expect(result.strategy).toBe('smart');
  });
});

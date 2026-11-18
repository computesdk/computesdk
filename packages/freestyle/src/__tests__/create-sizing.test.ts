import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Failure cases: a smaller native request silently keeps a larger snapshot;
// an environment snapshot bypasses the sizeClass guard; growth or guest
// hotplug fails and leaves a paid VM behind; supported growth is not forwarded.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  data: vi.fn(),
  resize: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('freestyle', () => ({
  FreestyleApiError: class extends Error {},
  Freestyle: class {
    vms = { create: mocks.create, delete: mocks.delete };
  },
}));

import { freestyle } from '../index';

describe('create: exact requested Freestyle resources', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('FREESTYLE_SNAPSHOT_ID', '');
    vi.stubEnv('FREESTYLE_API_URL', '');
    mocks.create.mockResolvedValue({
      vmId: 'vm-test',
      vm: { data: mocks.data, resize: mocks.resize, exec: mocks.exec },
    });
    mocks.data.mockResolvedValue({ resources: { cpu: 4, memory: 8192 } });
    mocks.resize.mockResolvedValue({ resources: { cpu: 8, memory: 16384 } });
    mocks.exec.mockResolvedValue({ statusCode: 0, stdout: '8\n16777216\n' });
    mocks.delete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([{ cpu: 2 }, { memory: 4096 }, { cpu: 8, memory: 4096 }])(
    'rejects a grow-only snapshot mismatch and deletes the VM (%j)', async options => {
      await expect(freestyle({ apiKey: 'test-key' }).sandbox.create(options))
        .rejects.toThrow(/grow-only/);
      expect(mocks.resize).not.toHaveBeenCalled();
      expect(mocks.delete).toHaveBeenCalledWith('vm-test');
    },
  );

  it('does not resize when the snapshot already matches', async () => {
    await freestyle({ apiKey: 'test-key' }).sandbox.create({ cpu: 4, memory: 8192 });
    expect(mocks.resize).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('grows both axes and waits for guest resources', async () => {
    await freestyle({ apiKey: 'test-key' }).sandbox.create({ cpu: 8, memory: 16384 });
    expect(mocks.resize).toHaveBeenCalledWith({ cpu: 8, memory: 16384 });
    expect(mocks.exec).toHaveBeenCalledWith(expect.objectContaining({ command: expect.stringContaining('nproc') }));
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('only sends the requested growing axis', async () => {
    await freestyle({ apiKey: 'test-key' }).sandbox.create({ cpu: 8 });
    expect(mocks.resize).toHaveBeenCalledWith({ cpu: 8 });
  });

  it('deletes the VM if resize fails', async () => {
    mocks.resize.mockRejectedValue(new Error('quota exceeded'));
    await expect(freestyle({ apiKey: 'test-key' }).sandbox.create({ cpu: 8 }))
      .rejects.toThrow('quota exceeded');
    expect(mocks.delete).toHaveBeenCalledWith('vm-test');
  });

  it('deletes the VM if the guest resource probe fails', async () => {
    mocks.exec.mockRejectedValue(new Error('guest unavailable'));
    await expect(freestyle({ apiKey: 'test-key' }).sandbox.create({ cpu: 8 }))
      .rejects.toThrow('guest unavailable');
    expect(mocks.delete).toHaveBeenCalledWith('vm-test');
  });

  it('rejects standard sizes for a snapshot selected through the environment', async () => {
    vi.stubEnv('FREESTYLE_SNAPSHOT_ID', 'custom-snapshot');
    await expect(freestyle({ apiKey: 'test-key' }).sandbox.create({ sizeClass: 'lg' }))
      .rejects.toMatchObject({ code: 'unsupported' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

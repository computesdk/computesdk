import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));

vi.mock('modal', () => ({
  SandboxFilesystemNotFoundError: class extends Error {},
  ModalClient: class {
    apps = { fromName: async () => ({}) };
    images = { fromRegistry: () => ({ build: async () => ({}) }) };
    sandboxes = { create: async () => ({ sandboxId: 'sb-timeout', exec }) };
  },
}));

import { modal, ModalCommandTimeoutError } from '../index';

async function instance() {
  return modal({ tokenId: 'mock', tokenSecret: 'mock' }).instances.create();
}

describe('Modal command timeout preflight (native SDK mocks)', () => {
  beforeEach(() => {
    exec.mockReset();
    exec.mockImplementation(async (argv: string[], options?: { timeoutMs?: number }) => {
      // Model modal@0.11.0's nonpositive/precision checks, not its
      // contradictory zero-default comment. Provider preflight additionally
      // rejects malformed numeric inputs. This fake never calls a provider.
      if (options?.timeoutMs !== undefined &&
          (options.timeoutMs <= 0 || (options.timeoutMs && options.timeoutMs % 1000 !== 0))) {
        throw new Error('native timeout precision rejection');
      }
      const text = argv[0] === 'cat' &&
        (argv[1].endsWith('len') || argv[1].endsWith('.code')) ? '0' : '';
      return { stdout: { readText: async () => text }, wait: async () => 0 };
    });
  });

  it.each([undefined, 1000, 2000])('forwards supported timeout %s unchanged', async timeout => {
    const sandbox = await instance();
    await expect(sandbox.runCommand('true', { timeout })).resolves.toMatchObject({
      stdout: '', stderr: '', exitCode: 0,
    });
    const launches = exec.mock.calls.filter(([argv]) => argv[0] === 'sh');
    expect(launches).toHaveLength(1);
    expect(launches[0][1]).toMatchObject({ timeoutMs: timeout });
  });

  it.each([0, -1, 1, 1500, NaN, Infinity, -Infinity, '1000' as unknown as number])(
    'rejects unsupported timeout %s before native exec, not as guest exit127',
    async timeout => {
      const sandbox = await instance();
      const operation = sandbox.runCommand('secret-command', { timeout });
      await expect(operation).rejects.toBeInstanceOf(ModalCommandTimeoutError);
      await expect(operation).rejects.toMatchObject({
        name: 'ModalCommandTimeoutError', code: 'MODAL_COMMAND_TIMEOUT_UNSUPPORTED', provider: 'modal',
      });
      await expect(operation).rejects.not.toThrow('secret-command');
      expect(exec).not.toHaveBeenCalled();
    },
  );
});

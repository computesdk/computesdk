/**
 * Beam Provider Tests
 *
 * Uses the shared test suite from @computesdk/test-utils to validate
 * all provider functionality including:
 * - Sandbox lifecycle (create, getById, list, destroy)
 * - Code execution (runCode with Python and Node.js)
 * - Command execution (runCommand)
 * - Filesystem operations (read, write, mkdir, readdir, exists, remove)
 *
 * Integration tests require BEAM_TOKEN and BEAM_WORKSPACE_ID environment variables.
 * Tests are skipped if the token is not available.
 */

import { runProviderTestSuite } from '@computesdk/test-utils';
import { Sandbox, type SandboxInstance } from '@beamcloud/beam-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { beam } from '../index';

// Run the shared provider test suite
runProviderTestSuite({
  name: 'beam',
  // Create provider instance with empty config (will use BEAM_TOKEN env var)
  provider: beam({}),
  // Beam supports filesystem operations via shell commands + native listFiles
  supportsFilesystem: true,
  // Skip integration tests if required environment variables are not set
  skipIntegration: !process.env.BEAM_TOKEN || !process.env.BEAM_WORKSPACE_ID,
});

function mockSandbox() {
  const process = {
    wait: vi.fn().mockResolvedValue(undefined),
    stdout: { read: vi.fn().mockResolvedValue('') },
    stderr: { read: vi.fn().mockResolvedValue('') },
    exitCode: 0,
  };
  const instance = {
    containerId: 'sandbox-123',
    exec: vi.fn().mockResolvedValue(process),
    exposePort: vi.fn().mockResolvedValue('https://sandbox.example'),
    fs: {
      listFiles: vi.fn().mockResolvedValue([]),
    },
  } as unknown as SandboxInstance;
  vi.spyOn(Sandbox.prototype, 'create').mockResolvedValue(instance);
  return instance;
}

describe('lazy sandbox readiness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('connects once before concurrent native operations', async () => {
    const instance = mockSandbox();
    let connected = false;
    const connect = vi.spyOn(Sandbox, 'connect').mockImplementation(async () => {
      connected = true;
      return instance;
    });
    vi.mocked(instance.exposePort).mockImplementation(async () => {
      expect(connected).toBe(true);
      return 'https://sandbox.example';
    });
    vi.mocked(instance.fs.listFiles).mockImplementation(async () => {
      expect(connected).toBe(true);
      return [];
    });

    const sandbox = await beam({ token: 'token', workspaceId: 'workspace' }).sandbox.create();
    await Promise.all([
      sandbox.getUrl({ port: 3000 }),
      sandbox.filesystem.readdir('/tmp'),
    ]);

    expect(connect).toHaveBeenCalledOnce();
  });

  test('does not reconnect after a successful command', async () => {
    const instance = mockSandbox();
    const connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(instance);
    const sandbox = await beam({ token: 'token', workspaceId: 'workspace' }).sandbox.create();

    await sandbox.runCommand('true');
    await sandbox.getUrl({ port: 3000 });
    await sandbox.filesystem.readdir('/tmp');

    expect(connect).not.toHaveBeenCalled();
  });
});

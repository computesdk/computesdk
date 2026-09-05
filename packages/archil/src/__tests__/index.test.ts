import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import * as indexExports from '../index';
import { archil } from '../index';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function successExecResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        timing: { totalMs: 0, queueMs: 0, executeMs: 0 },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('archil filesystem writeFile chunking', () => {
  it('splits large writes into commands under the 102400-byte limit', async () => {
    const fetchMock = vi.fn(async (_input, init) => successExecResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });
    const content = 'x'.repeat(100 * 1024); // 100 KiB raw -> >100 KiB base64
    await sandbox.filesystem.writeFile('/tmp/bench/file.txt', content);

    const execCalls = (fetchMock.mock.calls as any[][]).filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST' && String(call[0]).includes('/exec');
    });

    const commandBodies = execCalls.map(([, init]) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return JSON.parse(body).command as string;
    });

    const writeCommands = commandBodies.filter((cmd) => cmd.includes('base64 -d'));
    expect(writeCommands.length).toBeGreaterThan(1);
    for (const cmd of writeCommands) {
      expect(cmd.length).toBeLessThanOrEqual(102400);
    }
  });

  it('serializes concurrent disk commands so they do not race on shared state', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (_input, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return successExecResponse();
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    // Concurrent runCommand calls to the same disk should be queued.
    await Promise.all([
      sandbox.runCommand('mkdir -p /tmp/bench/dir'),
      sandbox.runCommand('touch /tmp/bench/dir/file.txt'),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it('creates or truncates the file for empty content', async () => {
    const fetchMock = vi.fn(async (_input, init) => successExecResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });
    await sandbox.filesystem.writeFile('/tmp/bench/empty.txt', '');

    const execCalls = (fetchMock.mock.calls as any[][]).filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST' && String(call[0]).includes('/exec');
    });
    expect(execCalls.length).toBeGreaterThanOrEqual(1);
    const commandBodies = execCalls.map(([, init]) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return JSON.parse(body).command as string;
    });
    expect(commandBodies.some((cmd) => cmd.trimEnd().endsWith(`> '/tmp/bench/empty.txt'`))).toBe(true);
  });
});

describe('archil export shape', () => {
  it('is resolvable via camelCase conversion of the hyphenated provider name', () => {
    // Workbench resolves provider names by camelCase conversion. 'archil' is
    // already a single token, so the export must literally be `archil`.
    const exportName = 'archil'.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(typeof (indexExports as Record<string, unknown>)[exportName]).toBe('function');
  });

  it('uses the correct provider name', () => {
    const provider = archil({ apiKey: 'test', region: 'aws-us-east-1' });
    expect(provider.name).toBe('archil');
  });
});

describe('archil getById semantics', () => {
  it('resolves an existing disk by id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'disk_123',
            name: 'my-workspace',
            organization: 'org',
            status: 'ready',
            provider: 'archil',
            region: 'aws-us-east-1',
            createdAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.getById('disk_123');

    expect(sandbox?.sandboxId).toBe('disk_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstUrl = String((fetchMock.mock.calls as any[][])[0][0]);
    expect(firstUrl).toContain('/api/disks/disk_123');
  });

  it('does not fall back to name lookup when id lookup fails', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.getById('my-workspace');

    expect(sandbox).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstUrl = String((fetchMock.mock.calls as any[][])[0][0]);
    expect(firstUrl).toContain('/api/disks/my-workspace');
    expect((fetchMock.mock.calls as any[][]).some((call) => String(call[0]).endsWith('/api/disks'))).toBe(false);
  });
});

describe('archil create semantics', () => {
  it('requires top-level disk id', async () => {
    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    await expect(provider.sandbox.create()).rejects.toThrow(/requires an existing disk id on the top-level options/i);
  });

  it('uses an existing disk id without fetching it', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const created = await provider.sandbox.create({ diskId: 'disk_abc123' });
    const info = await created.getInfo();

    expect(created.sandboxId).toBe('disk_abc123');
    expect(info).toMatchObject({ id: 'disk_abc123', status: 'running' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

runProviderTestSuite({
  name: 'archil',
  provider: (() => {
    const provider = archil({
      apiKey: process.env.ARCHIL_API_KEY,
      region: process.env.ARCHIL_REGION,
    });

    // The generic provider test suite always calls create() without provider-
    // specific options.
    // Archil create() requires an explicit disk id, so inject ARCHIL_DISK_ID.
    const originalCreate = provider.sandbox.create.bind(provider.sandbox);
    const configuredDiskId = process.env.ARCHIL_DISK_ID;

    provider.sandbox.create = async (options?: any) => {
      const requested = options?.diskId as string | undefined;
      if (requested) {
        return originalCreate(options);
      }

      if (!configuredDiskId) {
        throw new Error('Archil integration tests require ARCHIL_DISK_ID.');
      }

      return originalCreate({
        ...options,
        diskId: configuredDiskId,
      });
    };

    return provider;
  })(),
  // Archil filesystem mount points vary by account/runtime and are not yet
  // stable enough for generic provider-test-suite path assumptions.
  // Keep command/runtime integration coverage on, and add dedicated filesystem
  // integration once mount-path behavior is standardized.
  supportsFilesystem: false,
  supportsGetUrl: false,
  skipIntegration:
    !process.env.ARCHIL_API_KEY || !process.env.ARCHIL_REGION || !process.env.ARCHIL_DISK_ID,
});

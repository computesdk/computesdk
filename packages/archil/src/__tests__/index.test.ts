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

describe('archil filesystem mapping', () => {
  function execResponse(stdout = '', exitCode = 0): Response {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          stdout,
          stderr: '',
          exitCode,
          timing: { totalMs: 0, queueMs: 0, executeMs: 0 },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function commands(fetchMock: { mock: { calls: any[][] } }): string[] {
    return (fetchMock.mock.calls as any[][]).map((call) => {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as {
        command: string;
      };
      return body.command;
    });
  }

  it('maps public filesystem paths to the Archil mount', async () => {
    const fetchMock = vi.fn(async () => execResponse('hello'));
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(sandbox.filesystem.readFile('/tmp/hello.txt')).resolves.toBe(
      'hello',
    );

    expect(commands(fetchMock)[0]).toContain(
      "cat '/mnt/archil/tmp/hello.txt'",
    );
  });

  it('checks out and checks in mutating filesystem operations', async () => {
    const fetchMock = vi.fn(async () => execResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await sandbox.filesystem.mkdir('/tmp/data');
    await sandbox.filesystem.writeFile('/tmp/data/hello.txt', 'hello');
    await sandbox.filesystem.remove('/tmp/data/hello.txt');

    const mutationCommands = commands(fetchMock);
    expect(mutationCommands).toHaveLength(3);
    for (const command of mutationCommands) {
      expect(command).toContain("archil checkout --force --yes '/mnt/archil'");
      expect(command).toContain("archil checkin '/mnt/archil'");
    }
    expect(mutationCommands[0]).toContain(
      "mkdir -p '/mnt/archil/tmp/data'",
    );
    expect(mutationCommands[1]).toContain(
      "printf %s 'aGVsbG8=' | base64 -d > '/mnt/archil/tmp/data/hello.txt'",
    );
    expect(mutationCommands[2]).toContain(
      "rm -rf '/mnt/archil/tmp/data/hello.txt'",
    );
  });

  it('refuses to remove the disk mount root', async () => {
    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(sandbox.filesystem.remove('/')).rejects.toThrow(
      /refusing to remove the Archil disk mount root/i,
    );
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
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration:
    !process.env.ARCHIL_API_KEY || !process.env.ARCHIL_REGION || !process.env.ARCHIL_DISK_ID,
});

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
  function execResponse(
    stdout = '',
    exitCode = 0,
    stderr = '',
  ): Response {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          stdout,
          stderr,
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
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { command: string };
      return body.command.includes('wc -c')
        ? execResponse('5\n')
        : execResponse(Buffer.from('hello').toString('base64'));
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(sandbox.filesystem.readFile('/tmp/hello.txt')).resolves.toBe(
      'hello',
    );

    expect(commands(fetchMock)[0]).toContain(
      "wc -c < '/mnt/archil/tmp/hello.txt'",
    );
    expect(commands(fetchMock)[1]).toContain(
      "dd if='/mnt/archil/tmp/hello.txt' bs=1 skip=0 count=5",
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
      "printf %s 'aGVsbG8=' | base64 -d > '/mnt/archil/tmp/data/hello.txt.computesdk-write-",
    );
    expect(mutationCommands[1]).toContain(
      "'/mnt/archil/tmp/data/hello.txt'",
    );
    expect(mutationCommands[1]).toContain(
      "if [ -d '/mnt/archil/tmp/data/hello.txt' ]; then",
    );
    expect(mutationCommands[2]).toContain(
      "rm -rf '/mnt/archil/tmp/data/hello.txt'",
    );
  });

  it('chunks large writes within Archil exec limits', async () => {
    const fetchMock = vi.fn(async () => execResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await sandbox.filesystem.writeFile('/tmp/large.txt', 'x'.repeat(100_000));

    const writeCommands = commands(fetchMock);
    const chunkCommands = writeCommands.filter((command) =>
      command.includes('base64 -d'),
    );
    expect(chunkCommands.length).toBeGreaterThan(1);
    expect(
      writeCommands.every(
        (command) => Buffer.byteLength(command, 'utf8') <= 102_400,
      ),
    ).toBe(true);
    expect(writeCommands.at(-1)).toContain(
      "mv '/mnt/archil/tmp/large.txt.computesdk-write-",
    );
    expect(writeCommands.at(-1)).toContain(
      " '/mnt/archil/tmp/large.txt'",
    );
  });

  it('reads files larger than the Archil response limit in chunks', async () => {
    const content = '0123456789abcdef'.repeat(400_000);
    const bytes = Buffer.from(content, 'utf8');
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { command: string };
      if (body.command.includes('wc -c')) {
        return execResponse(`${bytes.length}\n`);
      }

      const match = body.command.match(/skip=(\d+) count=(\d+)/);
      if (!match) throw new Error(`Unexpected read command: ${body.command}`);
      const offset = Number(match[1]);
      const count = Number(match[2]);
      return execResponse(
        bytes.subarray(offset, offset + count).toString('base64'),
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(
      sandbox.filesystem.readFile('/tmp/large.txt'),
    ).resolves.toBe(content);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    expect(commands(fetchMock)[0]).toContain('wc -c');
    expect(
      commands(fetchMock).filter((command) => command.includes('dd if=')).length,
    ).toBeGreaterThan(1);
  });

  it('reads empty files without issuing a chunk command', async () => {
    const fetchMock = vi.fn(async () => execResponse('0\n'));
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(sandbox.filesystem.readFile('/tmp/empty.txt')).resolves.toBe(
      '',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes empty files without emitting a base64 chunk', async () => {
    const fetchMock = vi.fn(async () => execResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await sandbox.filesystem.writeFile('/tmp/empty.txt', '');

    const [command] = commands(fetchMock);
    expect(command).toContain(": > '/mnt/archil/tmp/empty.txt.computesdk-write-");
    expect(command).toContain(
      "mv '/mnt/archil/tmp/empty.txt.computesdk-write-",
    );
    expect(command).toContain(" '/mnt/archil/tmp/empty.txt'");
    expect(command).not.toContain('base64 -d');
  });

  it('rejects non-empty writes to existing directories', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(execResponse('', 1, 'destination is a directory'))
      .mockResolvedValueOnce(execResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(
      sandbox.filesystem.writeFile('/tmp/existing-dir', 'hello'),
    ).rejects.toThrow(
      'Failed to write /tmp/existing-dir: destination is a directory',
    );
    expect(commands(fetchMock)[0]).toContain(
      "if [ -d '/mnt/archil/tmp/existing-dir' ]; then",
    );
    expect(commands(fetchMock)[0]).toContain(
      "mv '/mnt/archil/tmp/existing-dir.computesdk-write-",
    );
  });

  it('rejects empty writes to existing directories', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(execResponse('', 1, 'destination is a directory'))
      .mockResolvedValueOnce(execResponse());
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(
      sandbox.filesystem.writeFile('/tmp/existing-dir', ''),
    ).rejects.toThrow(
      'Failed to write /tmp/existing-dir: destination is a directory',
    );
    expect(commands(fetchMock)[0]).toContain(
      "if [ -d '/mnt/archil/tmp/existing-dir' ]; then",
    );
    expect(commands(fetchMock)[0]).toContain(
      "mv '/mnt/archil/tmp/existing-dir.computesdk-write-",
    );
  });

  it('stops after a failed chunk and cleans up the staged file', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      return callCount === 2
        ? execResponse('', 1, 'chunk failed')
        : execResponse();
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(
      sandbox.filesystem.writeFile('/tmp/partial.txt', 'x'.repeat(200_000)),
    ).rejects.toThrow('Failed to write /tmp/partial.txt: chunk failed');

    const writeCommands = commands(fetchMock);
    expect(
      writeCommands.filter((command) => command.includes('base64 -d')),
    ).toHaveLength(2);
    expect(writeCommands.at(-1)).toContain(
      "rm -f '/mnt/archil/tmp/partial.txt.computesdk-write-",
    );
  });

  it('refuses to remove the disk mount root', async () => {
    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await expect(sandbox.filesystem.remove('/')).rejects.toThrow(
      /refusing to remove the Archil disk mount root/i,
    );
  });

  it('serializes concurrent disk writes so chunks do not interleave', async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return execResponse();
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const sandbox = await provider.sandbox.create({ diskId: 'disk_abc123' });

    await Promise.all([
      sandbox.filesystem.writeFile('/tmp/collide.txt', 'a'.repeat(100_000)),
      sandbox.filesystem.writeFile('/tmp/collide.txt', 'b'.repeat(100_000)),
    ]);

    const mutationCommands = commands(fetchMock).filter((command) =>
      command.includes('base64 -d'),
    );

    // A 100 KiB raw payload base64-encodes to ~136 KiB. With the temp-path
    // staging from the main implementation that is included in the chunk-size
    // calculation, the exact number of chunks can vary; the key invariant is that
    // every write begins with a truncate ('>') and completes all of its append
    // ('>>') chunks before the next write's truncate begins.
    const redirects = mutationCommands.map((command) => {
      const match = command.match(/base64 -d (>>?) /);
      return match ? (match[1] === '>' ? 'truncate' : 'append') : 'unknown';
    });

    const groups: string[][] = [];
    for (const redirect of redirects) {
      if (redirect === 'truncate') {
        groups.push([redirect]);
      } else {
        expect(groups.length).toBeGreaterThan(0);
        groups[groups.length - 1].push(redirect);
      }
    }

    expect(groups.length).toBe(2);
    for (const group of groups) {
      expect(group[0]).toBe('truncate');
      expect(group.slice(1).every((r) => r === 'append')).toBe(true);
    }
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflare } from '../index.js';

const SANDBOX_ID = '0123456789abcdef'.repeat(4);
const OTHER_SANDBOX_ID = 'fedcba9876543210'.repeat(4);

function sse(events: Array<{ event: string; data: string }>): string {
  return events
    .map(({ event, data }) => `event: ${event}\ndata: ${data}\n`)
    .join('\n');
}

function bridgeCreateResponse(id = SANDBOX_ID): Response {
  return Response.json({ id });
}

function bridgeExecResponse(
  events: Array<{ event: string; data: string }>
): Response {
  return new Response(sse(events), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** The demo Worker answers the bridge info probe with 404. */
function withDemoInfo(fetchMock: ReturnType<typeof vi.fn>) {
  return vi.fn((url: string, init?: RequestInit) =>
    String(url).endsWith('/v1/info')
      ? Promise.resolve(new Response('Not Found', { status: 404 }))
      : fetchMock(url, init)
  );
}

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function directOutput(stdout = '', stderr = '', exitCode = 0) {
  return {
    stdout: bytes(stdout),
    stderr: bytes(stderr),
    exitCode,
  };
}

function createDirectBinding(
  execImplementation: (
    argv: string[],
    cwd: string | undefined,
    timeoutMs: number
  ) => Promise<ReturnType<typeof directOutput>> = async (argv) => {
    const command = argv[2] || '';
    if (command.includes('nonexistent-command')) {
      return directOutput('', 'command not found', 127);
    }
    if (command.includes('find --')) {
      return directOutput(
        [
          'f',
          '4',
          '1735732800.25',
          'test\nfile.txt',
          'd',
          '4096',
          '1735736400.5',
          'subdir',
          '',
        ].join('\0')
      );
    }
    if (command.includes('stat -c %s')) {
      return directOutput('17\nMock file content');
    }
    return directOutput();
  }
) {
  let nextId = 0;
  const sandbox = {
    start: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn(execImplementation),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const binding = {
    newUniqueId: vi.fn(() => {
      const id = (nextId++).toString(16).padStart(64, '0');
      return { toString: () => id };
    }),
    idFromString: vi.fn((id: string) => {
      if (!/^[0-9a-f]{64}$/.test(id)) throw new TypeError('invalid id');
      return { toString: () => id };
    }),
    get: vi.fn(() => sandbox),
  };

  return { binding, sandbox };
}

describe('Cloudflare direct mode', () => {
  it('creates and starts a sandbox through the Durable Object binding', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });

    const created = await provider.sandbox.create();

    expect(binding.newUniqueId).toHaveBeenCalledOnce();
    expect(binding.get).toHaveBeenCalledOnce();
    expect(sandbox.start).toHaveBeenCalledOnce();
    expect(sandbox.start).toHaveBeenCalledWith(undefined);
    expect(created.sandboxId).toBe('0'.repeat(64));
  });

  it('passes the sandbox size and image to start', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });

    await provider.sandbox.create({
      vcpu: 2,
      memoryMib: 6144,
      diskMb: 12000,
      image: 'builder',
    });

    expect(sandbox.start).toHaveBeenCalledOnce();
    expect(sandbox.start).toHaveBeenCalledWith({
      vcpu: 2,
      memoryMib: 6144,
      diskMb: 12000,
      image: 'builder',
    });
  });


  it('generates unique sandbox IDs under concurrency', async () => {
    const { binding } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => provider.sandbox.create())
    );
    const sandboxIds = results.map((result) => result.sandboxId);

    expect(new Set(sandboxIds).size).toBe(sandboxIds.length);
  });

  it('uses an existing native Durable Object ID when provided', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });

    const created = await provider.sandbox.create({ sandboxId: SANDBOX_ID });

    expect(binding.idFromString).toHaveBeenCalledWith(SANDBOX_ID);
    expect(binding.newUniqueId).not.toHaveBeenCalled();
    expect(sandbox.start).toHaveBeenCalledOnce();
    expect(created.sandboxId).toBe(SANDBOX_ID);
  });

  it('executes commands through the direct RPC contract', async () => {
    const { binding, sandbox } = createDirectBinding(async () =>
      directOutput('hello\n', 'warning\n', 3)
    );
    const provider = cloudflare({
      sandboxBinding: binding,
      timeout: 45_000,
      envVars: { PROVIDER_ENV: 'provider' },
    });
    const created = await provider.sandbox.create({
      envs: { SANDBOX_ENV: 'sandbox' },
    });

    const result = await created.runCommand('echo hello', {
      cwd: '/tmp',
      env: { COMMAND_ENV: 'command' },
      timeout: 12_345,
    });

    expect(sandbox.exec).toHaveBeenCalledWith(
      [
        'sh',
        '-lc',
        "export PROVIDER_ENV='provider'; export SANDBOX_ENV='sandbox'; export COMMAND_ENV='command'; echo hello",
      ],
      '/tmp',
      12_345
    );
    expect(result).toMatchObject({
      stdout: 'hello\n',
      stderr: 'warning\n',
      exitCode: 3,
    });
  });

  it('uses provider and command execution timeouts, not the create timeout', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding, timeout: 45_000 });
    const created = await provider.sandbox.create({ timeout: 1 });

    await created.runCommand('true');
    expect(sandbox.exec).toHaveBeenLastCalledWith(
      ['sh', '-lc', 'true'],
      undefined,
      45_000
    );

    const invalid = await created.runCommand('true', { timeout: 900_001 });
    expect(invalid.exitCode).toBe(127);
    expect(invalid.stderr).toContain('no greater than 900000');
  });

  it('rejects invalid provider execution timeouts', async () => {
    const { binding } = createDirectBinding();
    await expect(
      cloudflare({ sandboxBinding: binding, timeout: 0 }).sandbox.create()
    ).rejects.toThrow('Execution timeout must be greater than 0');
  });

  it('gets an existing sandbox without starting it', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({
      sandboxBinding: binding,
      envVars: { RECONNECTED: 'yes' },
    });

    const result = await provider.sandbox.getById(SANDBOX_ID);

    expect(binding.idFromString).toHaveBeenCalledWith(SANDBOX_ID);
    expect(sandbox.start).not.toHaveBeenCalled();
    expect(sandbox.exec).toHaveBeenCalledWith(['true'], undefined, 30_000);
    expect(result?.sandboxId).toBe(SANDBOX_ID);

    await result?.runCommand('echo ready');
    expect(sandbox.exec).toHaveBeenLastCalledWith(
      ['sh', '-lc', "export RECONNECTED='yes'; echo ready"],
      undefined,
      30_000
    );
  });

  it('returns null when a direct sandbox cannot be reached', async () => {
    const { binding } = createDirectBinding(async () => {
      throw new Error('container is not running');
    });
    const provider = cloudflare({ sandboxBinding: binding });

    await expect(provider.sandbox.getById(SANDBOX_ID)).resolves.toBeNull();
    await expect(provider.sandbox.getById('not-an-id')).resolves.toBeNull();
  });

  it('destroys a sandbox through the direct RPC contract', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });

    await provider.sandbox.destroy(SANDBOX_ID);

    expect(binding.idFromString).toHaveBeenCalledWith(SANDBOX_ID);
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it('propagates direct destroy failures', async () => {
    const { binding, sandbox } = createDirectBinding();
    sandbox.destroy.mockRejectedValueOnce(new Error('destroy failed'));
    const provider = cloudflare({ sandboxBinding: binding });

    await expect(provider.sandbox.destroy(SANDBOX_ID)).rejects.toThrow(
      'destroy failed'
    );
  });

  it('implements filesystem operations through exec', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();

    await expect(created.filesystem.readFile('/tmp/test.txt')).resolves.toBe(
      'Mock file content'
    );
    await created.filesystem.writeFile('/tmp/test.txt', "it's safe");
    await created.filesystem.mkdir('/tmp/test dir');
    await created.filesystem.remove('/tmp/test.txt');
    await expect(created.filesystem.readdir('/tmp')).resolves.toEqual([
      {
        name: 'test\nfile.txt',
        type: 'file',
        size: 4,
        modified: new Date('2025-01-01T12:00:00.250Z'),
      },
      {
        name: 'subdir',
        type: 'directory',
        size: 4096,
        modified: new Date('2025-01-01T13:00:00.500Z'),
      },
    ]);

    const commands = sandbox.exec.mock.calls.map((call) => call[0][2]);
    const readCall = sandbox.exec.mock.calls.find((call) =>
      call[0][2]?.includes('stat -c %s')
    );
    expect(readCall?.[0].slice(0, 2)).toEqual(['sh', '-c']);
    expect(readCall?.[0][3]).toBe('/tmp/test.txt');
    const writeCall = sandbox.exec.mock.calls.find((call) =>
      call[0][2]?.includes('base64 -d | dd')
    );
    expect(writeCall).toBeDefined();
    expect(writeCall?.[0][3]).toMatch(/^\/tmp\/\.computesdk-/);
    expect(writeCall?.[0][4]).toBe('0');
    expect(
      Buffer.from(writeCall?.[0][5] || '', 'base64').toString()
    ).toBe("it's safe");
    expect(
      commands.some(
        (command) =>
          command.startsWith("cat -- '/tmp/.computesdk-") &&
          command.includes(" > '/tmp/test.txt' && rm -f -- '/tmp/.computesdk-")
      )
    ).toBe(true);
    expect(commands).toContain("mkdir -p -- '/tmp/test dir'");
    expect(commands).toContain("rm -rf -- '/tmp/test.txt'");
    expect(commands).toContain(
      "find -- '/tmp' -mindepth 1 -maxdepth 1 -printf '%y\\0%s\\0%T@\\0%f\\0'"
    );
  });

  it('writes through existing file and symlink targets instead of replacing them', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();

    await created.filesystem.writeFile('/tmp/existing', 'new content');

    const commands = sandbox.exec.mock.calls.map((call) => call[0][2]);
    expect(
      commands.some(
        (command) =>
          command.startsWith("cat -- '/tmp/.computesdk-") &&
          command.includes(" > '/tmp/existing' && rm -f -- ")
      )
    ).toBe(true);
    expect(commands.some((command) => command.startsWith('mv '))).toBe(false);
  });

  it('rejects a directory as a write destination and cleans up', async () => {
    const { binding, sandbox } = createDirectBinding(async (argv) => {
      const command = argv[2] || '';
      return command.includes(" > '/tmp/directory'")
        ? directOutput('', 'Is a directory', 1)
        : directOutput();
    });
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();

    await expect(
      created.filesystem.writeFile('/tmp/directory', 'content')
    ).rejects.toThrow('File write failed: Is a directory');

    const commands = sandbox.exec.mock.calls.map((call) => call[0][2]);
    expect(
      commands.some((command) =>
        command.startsWith("rm -f -- '/tmp/.computesdk-")
      )
    ).toBe(true);
  });

  it('prefixes relative directory paths before passing them to find', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();

    await created.filesystem.readdir('-name');
    await created.filesystem.readdir('!');

    const commands = sandbox.exec.mock.calls.map((call) => call[0][2]);
    expect(commands).toContain(
      "find -- './-name' -mindepth 1 -maxdepth 1 -printf '%y\\0%s\\0%T@\\0%f\\0'"
    );
    expect(commands).toContain(
      "find -- './!' -mindepth 1 -maxdepth 1 -printf '%y\\0%s\\0%T@\\0%f\\0'"
    );
  });

  it('writes large content and null bytes in bounded chunks', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();
    const content = `${'a'.repeat(150_000)}\0tail\n`;

    await created.filesystem.writeFile('/tmp/large.bin', content);

    const encodedChunks = sandbox.exec.mock.calls
      .filter((call) => call[0][2]?.includes('base64 -d | dd'))
      .flatMap((call) => call[0].slice(5));
    expect(encodedChunks.length).toBeGreaterThan(1);
    expect(
      encodedChunks.every((encoded) => encoded.length < 128 * 1024)
    ).toBe(true);
    const reconstructed = Buffer.concat(
      encodedChunks.map((encoded) => Buffer.from(encoded, 'base64'))
    ).toString();
    expect(reconstructed).toBe(content);
  });

  it('writes multi-megabyte content as parallel positioned ranges', async () => {
    const { binding, sandbox } = createDirectBinding();
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();
    const content = 'x'.repeat(3 * 1024 * 1024 + 7);

    await created.filesystem.writeFile('/tmp/big.bin', content);

    const ranges = sandbox.exec.mock.calls
      .filter((call) => call[0][2]?.includes('base64 -d | dd'))
      .map((call) => ({
        offset: Number(call[0][4]),
        bytes: Buffer.concat(
          call[0].slice(5).map((encoded) => Buffer.from(encoded, 'base64'))
        ),
      }))
      .sort((a, b) => a.offset - b.offset);
    expect(ranges.length).toBeGreaterThan(1);
    let expected = 0;
    for (const range of ranges) {
      expect(range.offset).toBe(expected);
      expected += range.bytes.length;
    }
    expect(Buffer.concat(ranges.map((range) => range.bytes)).toString()).toBe(
      content
    );
  });

  it('reads large files in bounded ranges and reassembles them', async () => {
    const content = Buffer.from('é'.repeat(5 * 1024 * 1024));
    const { binding, sandbox } = createDirectBinding(async (argv) => {
      const command = argv[2] || '';
      if (command.includes('stat -c %s')) {
        const count = Number(argv[4]);
        return {
          stdout: Buffer.concat([
            Buffer.from(`${content.length}\n`),
            content.subarray(0, count),
          ]).buffer as ArrayBuffer,
          stderr: bytes(''),
          exitCode: 0,
        };
      }
      if (command.includes('skip_bytes')) {
        const offset = Number(argv[4]);
        const count = Number(argv[5]);
        return {
          stdout: new Uint8Array(content.subarray(offset, offset + count))
            .buffer as ArrayBuffer,
          stderr: bytes(''),
          exitCode: 0,
        };
      }
      return directOutput();
    });
    const provider = cloudflare({ sandboxBinding: binding });
    const created = await provider.sandbox.create();

    await expect(created.filesystem.readFile('/tmp/big.txt')).resolves.toBe(
      content.toString('utf8')
    );
    const rangeCalls = sandbox.exec.mock.calls.filter((call) =>
      call[0][2]?.includes('skip_bytes')
    );
    expect(rangeCalls.length).toBeGreaterThan(1);
    expect(rangeCalls.every((call) => Number(call[0][5]) <= 4 * 1024 * 1024)).toBe(
      true
    );
  });
});

describe('Cloudflare remote bridge mode', () => {
  it('creates a sandbox before the first remote operation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(
        bridgeExecResponse([
          {
            event: 'stdout',
            data: Buffer.from('v22.0.0\n').toString('base64'),
          },
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
        envVars: { TEST_ENV: 'value' },
      });

      const created = await provider.sandbox.create();
      expect(created.sandboxId).toBe(SANDBOX_ID);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://example.com/v1/sandbox'
      );
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
      expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();

      const result = await created.runCommand('node -v');
      expect(result.exitCode).toBe(0);

      const call = fetchMock.mock.calls[1];
      expect(call?.[0]).toBe(
        `https://example.com/v1/sandbox/${SANDBOX_ID}/exec`
      );
      const body = JSON.parse(call?.[1]?.body as string);
      expect(body).toEqual({
        argv: ['sh', '-lc', "export TEST_ENV='value'; node -v"],
        timeout_ms: 30_000,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends the sandbox size and image when creating a sandbox', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bridgeCreateResponse());
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });

      await provider.sandbox.create({
        vcpu: 2,
        memoryMib: 6144,
        diskMb: 12000,
        image: 'builder',
      });

      const init = fetchMock.mock.calls[0]?.[1];
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init?.body as string)).toEqual({
        vcpu: 2,
        memoryMib: 6144,
        diskMb: 12000,
        image: 'builder',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects IDs that are not native Durable Object IDs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse('abcde'));
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });

      await expect(provider.sandbox.create()).rejects.toThrow(
        'missing or invalid sandbox id'
      );
      await expect(provider.sandbox.getById('abcde')).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses bridge exec stdout, stderr, and exit events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(
        bridgeExecResponse([
          {
            event: 'stdout',
            data: Buffer.from('hello\n').toString('base64'),
          },
          {
            event: 'stderr',
            data: Buffer.from('warn\n').toString('base64'),
          },
          { event: 'exit', data: JSON.stringify({ exit_code: 42 }) },
        ])
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();
      const result = await created.runCommand('echo hello');

      expect(result).toMatchObject({
        stdout: 'hello\n',
        stderr: 'warn\n',
        exitCode: 42,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects bridge exec responses without an exit event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(
        bridgeExecResponse([
          {
            event: 'stdout',
            data: Buffer.from('partial').toString('base64'),
          },
        ])
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();
      const result = await created.runCommand('echo partial');

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('without an exit event');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps bridge request failures to command errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();
      const result = await created.runCommand('node -v');

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('boom');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('implements filesystem operations through the exec endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(
        bridgeExecResponse([
          {
            event: 'stdout',
            data: Buffer.from('5\nhel').toString('base64'),
          },
          {
            event: 'stdout',
            data: Buffer.from('lo').toString('base64'),
          },
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();

      await expect(created.filesystem.readFile('/tmp/a.txt')).resolves.toBe(
        'hello'
      );
      const body = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
      expect(body.argv.slice(0, 2)).toEqual(['sh', '-c']);
      expect(body.argv.slice(3)).toEqual(['/tmp/a.txt', String(4 * 1024 * 1024)]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shell-quotes filesystem paths containing metacharacters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(
        bridgeExecResponse([
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();
      const maliciousPath = '/tmp/$(touch pwned)`whoami`\\!';
      await created.filesystem.mkdir(maliciousPath);

      const body = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
      expect(body.argv[2]).toContain(
        "mkdir -p -- '/tmp/$(touch pwned)`whoami`\\!'"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('verifies a remote sandbox without allocating one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        bridgeExecResponse([
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      )
      .mockResolvedValueOnce(
        bridgeExecResponse([
          { event: 'exit', data: JSON.stringify({ exit_code: 1 }) },
        ])
      )
      .mockResolvedValueOnce(
        bridgeExecResponse([
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
        envVars: { RECONNECTED: 'yes' },
      });

      const sandbox = await provider.sandbox.getById(SANDBOX_ID);
      expect(sandbox?.sandboxId).toBe(SANDBOX_ID);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `https://example.com/v1/sandbox/${SANDBOX_ID}/exec`
      );
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');

      await sandbox?.runCommand('echo ready');
      const body = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
      expect(body.argv).toEqual([
        'sh',
        '-lc',
        "export RECONNECTED='yes'; echo ready",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null when a remote sandbox cannot be reached', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('container is not running', { status: 500 })
      );
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      await expect(provider.sandbox.getById(SANDBOX_ID)).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('destroys remote sandboxes through the bridge', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse(OTHER_SANDBOX_ID))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();
      await created.destroy();

      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        `https://example.com/v1/sandbox/${OTHER_SANDBOX_ID}`
      );
      expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('propagates remote destroy failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse())
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();

      await expect(created.destroy()).rejects.toThrow(
        'Sandbox Worker request failed: 401 - unauthorized'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports port forwarding as unsupported', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bridgeCreateResponse());
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));

    try {
      const provider = cloudflare({
        sandboxUrl: 'https://example.com',
        sandboxApiKey: 'secret',
      });
      const created = await provider.sandbox.create();

      await expect(created.getUrl({ port: 3000 })).rejects.toThrow(
        'does not support port forwarding'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Cloudflare bridge Worker features', () => {
  const BRIDGE_URL = 'https://bridge.example.com';
  type Route = (init: RequestInit, url: URL) => Response | Promise<Response>;

  function bridgeFetch(routes: Record<string, Route>, features = ['exec-stream', 'files', 'ports', 'snapshots']) {
    const calls: Array<{ method: string; url: URL; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      calls.push({ method, url, init });
      if (url.pathname === '/v1/info') {
        return Response.json({ bridge: 'computesdk', version: 1, features });
      }
      const route = routes[`${method} ${url.pathname}`];
      return route ? route(init, url) : new Response('Not Found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls, fetchMock };
  }

  function bridgeProvider(url = BRIDGE_URL) {
    return cloudflare({ sandboxUrl: url, sandboxApiKey: 'secret' });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses native file routes for absolute paths', async () => {
    const written: Uint8Array[] = [];
    const { calls } = bridgeFetch({
      'POST /v1/sandbox': () => bridgeCreateResponse(),
      [`GET /v1/sandbox/${SANDBOX_ID}/files`]: (_init, url) =>
        url.searchParams.get('path') === '/tmp/missing'
          ? Response.json({ error: 'missing', code: 'ENOENT' }, { status: 404 })
          : new Response('héllo'),
      [`PUT /v1/sandbox/${SANDBOX_ID}/files`]: (init) => {
        written.push(init.body as Uint8Array);
        return new Response(null, { status: 204 });
      },
      [`POST /v1/sandbox/${SANDBOX_ID}/files/mkdir`]: () => new Response(null, { status: 204 }),
      [`DELETE /v1/sandbox/${SANDBOX_ID}/files`]: () => new Response(null, { status: 204 }),
      [`GET /v1/sandbox/${SANDBOX_ID}/files/list`]: () =>
        Response.json({
          entries: [
            { name: 'a.txt', type: 'file', size: 5, modifiedAt: '2026-01-01T00:00:00.000Z' },
            { name: 'sub', type: 'directory', size: 4096, modifiedAt: '2026-01-02T00:00:00.000Z' },
          ],
        }),
      [`GET /v1/sandbox/${SANDBOX_ID}/files/stat`]: (_init, url) =>
        url.searchParams.get('path') === '/tmp/a.txt'
          ? Response.json({ type: 'file', size: 5, modifiedAt: '2026-01-01T00:00:00.000Z' })
          : Response.json({ error: 'not found', code: 'ENOENT' }, { status: 404 }),
    });
    const created = await bridgeProvider().sandbox.create();

    await expect(created.filesystem.readFile('/tmp/a.txt')).resolves.toBe('héllo');
    await expect(created.filesystem.readFile('/tmp/missing')).rejects.toThrow('404');
    await created.filesystem.writeFile('/tmp/a b.txt', 'héllo');
    expect(new TextDecoder().decode(written[0])).toBe('héllo');
    await created.filesystem.mkdir('/tmp/x/y');
    await created.filesystem.remove('/tmp/x');
    await expect(created.filesystem.readdir('/tmp')).resolves.toEqual([
      { name: 'a.txt', type: 'file', size: 5, modified: new Date('2026-01-01T00:00:00.000Z') },
      { name: 'sub', type: 'directory', size: 4096, modified: new Date('2026-01-02T00:00:00.000Z') },
    ]);
    await expect(created.filesystem.exists('/tmp/a.txt')).resolves.toBe(true);
    await expect(created.filesystem.exists('/tmp/nope')).resolves.toBe(false);

    const write = calls.find((call) => call.method === 'PUT')!;
    expect(write.url.searchParams.get('path')).toBe('/tmp/a b.txt');
    expect(calls.filter((call) => call.url.pathname === '/v1/info')).toHaveLength(1);
    expect(calls.some((call) => call.url.pathname.endsWith('/exec'))).toBe(false);
  });

  it('falls back to shell file transfer when the bridge lacks native files', async () => {
    const { calls } = bridgeFetch(
      {
        'POST /v1/sandbox': () => bridgeCreateResponse(),
        [`POST /v1/sandbox/${SANDBOX_ID}/exec`]: () =>
          bridgeExecResponse([{ event: 'exit', data: JSON.stringify({ exit_code: 0 }) }]),
      },
      ['ports']
    );
    const created = await bridgeProvider('https://ports-only.example.com').sandbox.create();
    await expect(created.filesystem.exists('/tmp/a.txt')).resolves.toBe(true);
    expect(calls.some((call) => call.url.pathname.endsWith('/exec'))).toBe(true);
  });

  it('returns preview URLs for ports', async () => {
    bridgeFetch({ 'POST /v1/sandbox': () => bridgeCreateResponse() });
    const created = await bridgeProvider(`${BRIDGE_URL}/`).sandbox.create();
    await expect(created.getUrl({ port: 3000 })).resolves.toBe(
      `${BRIDGE_URL}/v1/sandbox/${SANDBOX_ID}/ports/3000/`
    );
    await expect(created.getUrl({ port: 8080, protocol: 'wss' })).resolves.toBe(
      `wss://bridge.example.com/v1/sandbox/${SANDBOX_ID}/ports/8080/`
    );
    await expect(created.getUrl({ port: 0 })).rejects.toThrow('Invalid port');
  });

  it('creates, lists, restores from and deletes snapshots', async () => {
    const record = {
      id: 'snap-1',
      name: 'before',
      size: 1024,
      sandboxId: SANDBOX_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { calls } = bridgeFetch({
      'POST /v1/sandbox': () => bridgeCreateResponse(OTHER_SANDBOX_ID),
      [`POST /v1/sandbox/${SANDBOX_ID}/snapshot`]: () => Response.json(record),
      'GET /v1/snapshots': () =>
        Response.json({ snapshots: [record, { ...record, id: 'snap-2', sandboxId: OTHER_SANDBOX_ID }] }),
      'DELETE /v1/snapshots/snap-1': () => new Response(null, { status: 204 }),
    });
    const provider = bridgeProvider();

    const snapshot = await provider.snapshot!.create(SANDBOX_ID, { name: 'before' });
    expect(snapshot).toEqual({ ...record, createdAt: new Date(record.createdAt) });
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ name: 'before' });

    await expect(provider.snapshot!.list({ instanceId: SANDBOX_ID })).resolves.toHaveLength(1);
    await expect(provider.snapshot!.list()).resolves.toHaveLength(2);

    const restored = await provider.sandbox.create({ snapshotId: 'snap-1' } as any);
    expect(restored.instanceId).toBe(OTHER_SANDBOX_ID);
    const create = calls.find((call) => call.method === 'POST' && call.url.pathname === '/v1/sandbox')!;
    expect(JSON.parse(create.init.body as string)).toEqual({ snapshotId: 'snap-1' });

    await provider.snapshot!.delete('snap-1');
    expect(calls.at(-1)!.method).toBe('DELETE');
  });

  it('does not declare snapshot capabilities before live verification', () => {
    expect(bridgeProvider().snapshot?.capabilities).toBeUndefined();
  });

  it('refuses bridge-only features against the demo Worker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bridgeCreateResponse());
    vi.stubGlobal('fetch', withDemoInfo(fetchMock));
    const provider = bridgeProvider('https://demo.example.com');

    await expect(provider.snapshot!.create(SANDBOX_ID)).rejects.toThrow('ComputeSDK bridge Worker');
    await expect(provider.snapshot!.list()).rejects.toThrow('ComputeSDK bridge Worker');
    await expect(provider.sandbox.create({ snapshotId: 'snap-1' } as any)).rejects.toThrow(
      'ComputeSDK bridge Worker'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries the feature probe after a failure', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string) => {
      if (new URL(input).pathname === '/v1/info') {
        attempts += 1;
        if (attempts === 1) throw new Error('network down');
        return Response.json({ bridge: 'computesdk', version: 1, features: ['ports'] });
      }
      return bridgeCreateResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const created = await bridgeProvider('https://flaky.example.com').sandbox.create();
    await expect(created.getUrl({ port: 3000 })).rejects.toThrow('does not support port forwarding');
    await expect(created.getUrl({ port: 3000 })).resolves.toContain('/ports/3000/');
  });
});

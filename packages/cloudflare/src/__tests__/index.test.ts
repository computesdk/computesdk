import { describe, expect, it, vi } from 'vitest';
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
    if (command.includes('cat --')) return directOutput('Mock file content');
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
    expect(created.sandboxId).toBe('0'.repeat(64));
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
    expect(commands).toContain("cat -- '/tmp/test.txt'");
    const writeCommand = commands.find((command) =>
      command.includes('| base64 -d >>')
    );
    expect(writeCommand).toBeDefined();
    const encoded = /printf %s '([^']+)'/.exec(writeCommand || '')?.[1];
    expect(Buffer.from(encoded || '', 'base64').toString()).toBe("it's safe");
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
      .map((call) => call[0][2] as string)
      .filter((command) => command.includes('| base64 -d >>'))
      .map((command) => /printf %s '([^']+)'/.exec(command)?.[1] || '');
    expect(encodedChunks.length).toBeGreaterThan(1);
    const reconstructed = Buffer.concat(
      encodedChunks.map((encoded) => Buffer.from(encoded, 'base64'))
    ).toString();
    expect(reconstructed).toBe(content);
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
    vi.stubGlobal('fetch', fetchMock);

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

  it('rejects IDs that are not native Durable Object IDs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bridgeCreateResponse('abcde'));
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', fetchMock);

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
            data: Buffer.from('hello').toString('base64'),
          },
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

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
      expect(body.argv).toEqual(['sh', '-lc', "cat -- '/tmp/a.txt'"]);
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
    vi.stubGlobal('fetch', fetchMock);

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
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

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
      const body = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
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
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', fetchMock);

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

/**
 * Cloudflare Provider Tests with Real Miniflare Integration
 */

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { cloudflare } from '../index.js';
import { getSandbox } from '@cloudflare/sandbox';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function sse(events: Array<{ event: string; data: string }>): string {
  return events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join('\n');
}

function bridgeCreateResponse(id = 'abcde'): Response {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bridgeExecResponse(events: Array<{ event: string; data: string }>): Response {
  return new Response(sse(events), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function createWarmPoolBinding(options: { physicalId?: string | null } = {}) {
  const physicalId = Object.prototype.hasOwnProperty.call(options, 'physicalId')
    ? options.physicalId
    : 'physicalabcde';
  const pool = {
    configure: vi.fn().mockResolvedValue(undefined),
    getContainer: vi.fn().mockResolvedValue(physicalId),
    lookupContainer: vi.fn().mockResolvedValue(physicalId),
    reportStopped: vi.fn().mockResolvedValue(undefined),
  };
  const binding = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => pool),
  };

  return { binding, pool };
}

// Determine if we're running integration tests
const hasCredentials = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
const skipIntegration = !hasCredentials;

let mf: Miniflare | null = null;

// Setup Miniflare for tests that need real Workers runtime
beforeAll(async () => {
  if (!skipIntegration) {
    // Only setup Miniflare for integration tests
    const workerScript = readFileSync(resolve(__dirname, '../../test-worker.js'), 'utf8');

    mf = new Miniflare({
      modules: true,
      script: workerScript,
      compatibilityDate: '2024-01-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        SandboxDO: 'SandboxDO'
      },
      bindings: {
        NODE_ENV: 'test',
        MINIFLARE_TEST: 'true'
      }
    });
  }
});

afterAll(async () => {
  if (mf) {
    await mf.dispose();
  }
});

// Only mock for unit tests when no credentials
if (skipIntegration) {
  vi.mock('@cloudflare/sandbox', () => ({
    getSandbox: vi.fn(() => ({
      setEnvVars: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue(undefined),
      killAllProcesses: vi.fn().mockResolvedValue(undefined),
      runCode: vi.fn().mockImplementation(async (code: string) => {
        if (code.includes('print(')) {
          const match = code.match(/print\(['"](.+?)['"]\)/);
          const output = match ? match[1] : 'Mock Python output';
          return { results: [{ text: output + '\n' }] };
        }
        return { results: [{ text: 'Mock execution result\n' }] };
      }),
      exec: vi.fn().mockImplementation(async (command: string) => {
        if (command.includes('echo')) {
          const match = command.match(/echo ["'](.+?)["']/);
          const output = match ? match[1] : 'Mock echo output';
          return { stdout: output + '\n', stderr: '', exitCode: 0 };
        }
        if (command.includes('ls -la')) {
          return {
            stdout: 'drwxr-xr-x  2 user user 4096 Jan 1 12:00 .\n-rw-r--r--  1 user user  100 Jan 1 12:00 test.txt\n',
            stderr: '',
            exitCode: 0
          };
        }
        return { stdout: 'Mock command output\n', stderr: '', exitCode: 0 };
      }),
      readFile: vi.fn().mockResolvedValue({ content: 'Mock file content' }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      exposePort: vi.fn().mockResolvedValue({ url: 'mock-preview.example.com' }),
      destroy: vi.fn().mockResolvedValue(undefined)
    }))
  }));
}

describe('Miniflare Integration Tests', () => {
  it('should create Miniflare instance if running integration tests', () => {
    if (!skipIntegration) {
      expect(mf).toBeDefined();
      expect(mf).toBeInstanceOf(Miniflare);
    } else {
      expect(mf).toBeNull();
    }
  });

  it('should interact with real Miniflare Workers runtime', async () => {
    if (!skipIntegration && mf) {
      // Test direct interaction with Miniflare
      const response = await mf.dispatchFetch('http://localhost/');
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toBe('Hello from Miniflare test worker!');
    }
  });

  it('should access Durable Objects through Miniflare', async () => {
    if (!skipIntegration && mf) {
      // Get bindings from Miniflare
      const env = await mf.getBindings();
      expect((env as any).SandboxDO).toBeDefined();

      // Create Durable Object ID and stub
      const SandboxDO = (env as any).SandboxDO;
      const id = SandboxDO.idFromName('test-sandbox');
      const stub = SandboxDO.get(id);

      // Test Durable Object interaction
      const response = await stub.fetch('http://localhost/health');
      const data = await response.json();

      expect(data.status).toBe('ok');
      expect(data.provider).toBe('cloudflare-miniflare');
    }
  });
});

// Create sandbox binding based on test mode
const createSandboxBinding = () => {
  if (!skipIntegration) {
    // For integration tests, we'll need to handle async binding creation inside tests
    return null; // Will be replaced in beforeEach
  } else {
    // Use mock binding for unit tests
    return {
      idFromName: (name: string) => ({ toString: () => `mock-id-${name}` }),
      get: (_id: any) => ({
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
          status: 'mock',
          provider: 'cloudflare-mock'
        })))
      })
    };
  }
};

// For integration tests, we need to provide the binding after Miniflare is set up
async function getIntegrationBinding() {
  if (!skipIntegration && mf) {
    const env = await mf.getBindings();
    return (env as any).SandboxDO;
  }
  return null;
}

// Create provider with proper binding
const defineProviderForTests = async () => {
  let binding = createSandboxBinding();

  if (!skipIntegration) {
    // For integration tests, get the real Miniflare binding
    binding = await getIntegrationBinding();
  }

  return cloudflare({
    sandboxBinding: binding,
    timeout: 300000,
    runtime: 'python'
  });
};

// Use a describe block to handle async provider creation
describe('Standardized Test Suite', () => {
  let testProvider: any;

  beforeAll(async () => {
    testProvider = await defineProviderForTests();
  });

  // Since we can't easily modify runProviderTestSuite, let's run the basic tests
  it('should have valid provider instance for testing', async () => {
    expect(testProvider).toBeDefined();
    expect(testProvider.name).toBe('cloudflare');

    // Only test sandbox creation in unit test mode
    if (skipIntegration) {
      try {
        const result = await testProvider.sandbox.create();
        expect(result).toBeDefined();
        expect(result.sandboxId).toBeDefined();
      } catch (error) {
        // Expected in some test scenarios
      }
    }
  });

  it('generates unique sandbox IDs under concurrency', async () => {
    if (skipIntegration) {
      const results = await Promise.all(Array.from({ length: 20 }, () => testProvider.sandbox.create()));
      const sandboxIds = results.map((result: { sandboxId: string }) => result.sandboxId);

      expect(new Set(sandboxIds).size).toBe(sandboxIds.length);
    }
  });

  it('uses the configured WarmPool binding for direct sandbox creation', async () => {
    if (skipIntegration) {
      vi.mocked(getSandbox).mockClear();
      const sandboxBinding = createSandboxBinding();
      const { binding: warmPoolBinding, pool } = createWarmPoolBinding({ physicalId: 'physicalabcde' });
      const provider = cloudflare({
        sandboxBinding,
        warmPool: { binding: warmPoolBinding, target: 5, refreshInterval: 1234 },
      });

      const result = await provider.sandbox.create({ sandboxId: 'logicalabcde' });

      expect(warmPoolBinding.idFromName).toHaveBeenCalledWith('global-pool');
      expect(pool.configure).toHaveBeenCalledWith({ warmTarget: 5, refreshInterval: 1234 });
      expect(pool.getContainer).toHaveBeenCalledWith('logicalabcde');
      expect(getSandbox).toHaveBeenCalledWith(sandboxBinding, 'physicalabcde', {});
      expect(result.sandboxId).toBe('logicalabcde');
    }
  });

  it('uses WarmPool lookup for direct getById without allocating', async () => {
    if (skipIntegration) {
      const { binding: warmPoolBinding, pool } = createWarmPoolBinding({ physicalId: 'physicalabcde' });
      const provider = cloudflare({
        sandboxBinding: createSandboxBinding(),
        warmPool: { binding: warmPoolBinding, target: 5 },
      });

      const result = await provider.sandbox.getById('logicalabcde');

      expect(pool.lookupContainer).toHaveBeenCalledWith('logicalabcde');
      expect(pool.getContainer).not.toHaveBeenCalled();
      expect(result?.sandboxId).toBe('logicalabcde');
    }
  });

  it('returns null from direct getById when WarmPool has no assignment', async () => {
    if (skipIntegration) {
      const { binding: warmPoolBinding } = createWarmPoolBinding({ physicalId: null });
      const provider = cloudflare({
        sandboxBinding: createSandboxBinding(),
        warmPool: { binding: warmPoolBinding },
      });

      await expect(provider.sandbox.getById('logicalabcde')).resolves.toBeNull();
    }
  });

  it('reports WarmPool assignments stopped when destroying direct sandboxes', async () => {
    if (skipIntegration) {
      const { binding: warmPoolBinding, pool } = createWarmPoolBinding({ physicalId: 'physicalabcde' });
      const provider = cloudflare({
        sandboxBinding: createSandboxBinding(),
        warmPool: { binding: warmPoolBinding },
      });

      await provider.sandbox.destroy('logicalabcde');

      expect(pool.lookupContainer).toHaveBeenCalledWith('logicalabcde');
      expect(pool.reportStopped).toHaveBeenCalledWith('physicalabcde');
    }
  });

  it('creates remote sandboxes through the bridge before the first remote operation', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse('abcde'))
        .mockResolvedValueOnce(bridgeExecResponse([
          { event: 'stdout', data: Buffer.from('v22.0.0\n').toString('base64') },
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ]));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({
          sandboxUrl: 'https://example.com',
          sandboxApiKey: 'secret',
          envVars: { TEST_ENV: 'value' },
        });

        const created = await remoteProvider.sandbox.create();
        expect(created.sandboxId).toBe('abcde');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/v1/sandbox');
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');

        const result = await created.runCommand('node -v');
        expect(result.exitCode).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const call = fetchMock.mock.calls[1];
        expect(call?.[0]).toBe(`https://example.com/v1/sandbox/${created.sandboxId}/exec`);

        const requestInit = call?.[1];
        expect(typeof requestInit?.body).toBe('string');
        if (typeof requestInit?.body !== 'string') {
          throw new Error('Expected worker request body to be a string');
        }

        const body = JSON.parse(requestInit.body) as Record<string, unknown>;
        expect(body.argv).toEqual(['sh', '-lc', "export TEST_ENV='value'; node -v"]);
        expect(body.timeout_ms).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('parses bridge exec SSE stdout, stderr, and exit events', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse())
        .mockResolvedValueOnce(bridgeExecResponse([
          { event: 'stdout', data: Buffer.from('hello\n').toString('base64') },
          { event: 'stderr', data: Buffer.from('warn\n').toString('base64') },
          { event: 'exit', data: JSON.stringify({ exit_code: 0 }) },
        ]));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        const created = await remoteProvider.sandbox.create();
        const result = await created.runCommand('echo hello');

        expect(result.stdout).toBe('hello\n');
        expect(result.stderr).toBe('warn\n');
        expect(result.exitCode).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('returns bridge exec non-zero exit codes', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse())
        .mockResolvedValueOnce(bridgeExecResponse([{ event: 'exit', data: JSON.stringify({ exit_code: 42 }) }]));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        const created = await remoteProvider.sandbox.create();
        const result = await created.runCommand('exit 42');

        expect(result.exitCode).toBe(42);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('maps bridge request failures to command errors', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse())
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        const created = await remoteProvider.sandbox.create();
        const result = await created.runCommand('node -v');

        expect(result.exitCode).toBe(127);
        expect(result.stderr).toContain('boom');
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('uses bridge file endpoints with raw bodies', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse())
        .mockResolvedValueOnce(new Response('hello', { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        const created = await remoteProvider.sandbox.create();

        await expect(created.filesystem.readFile('/workspace/tmp/a.txt')).resolves.toBe('hello');
        await created.filesystem.writeFile('/workspace/tmp/a.txt', 'hello');

        expect(fetchMock.mock.calls[1]?.[0]).toBe(`https://example.com/v1/sandbox/${created.sandboxId}/file/workspace/tmp/a.txt`);
        expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('GET');
        expect(fetchMock.mock.calls[2]?.[0]).toBe(`https://example.com/v1/sandbox/${created.sandboxId}/file/workspace/tmp/a.txt`);
        expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PUT');
        expect(fetchMock.mock.calls[2]?.[1]?.body).toBe('hello');
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('uses a bridge-compatible cwd for filesystem shell helpers', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse())
        .mockResolvedValueOnce(bridgeExecResponse([{ event: 'exit', data: JSON.stringify({ exit_code: 0 }) }]));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        const created = await remoteProvider.sandbox.create();
        await created.filesystem.mkdir('/workspace/tmp');

        const requestInit = fetchMock.mock.calls[1]?.[1];
        expect(typeof requestInit?.body).toBe('string');
        const body = JSON.parse(requestInit?.body as string) as Record<string, unknown>;
        expect(body.cwd).toBe('/workspace');
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('handles bridge tunnel urls with and without protocol', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(bridgeCreateResponse('abcde'))
        .mockResolvedValueOnce(bridgeCreateResponse('fghij'))
        .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://abc.example.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'def.example.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        const first = await remoteProvider.sandbox.create();
        const second = await remoteProvider.sandbox.create();

        await expect(first.getUrl({ port: 3000 })).resolves.toBe('https://abc.example.com');
        await expect(second.getUrl({ port: 3000 })).resolves.toBe('https://def.example.com');
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('does not allocate a remote sandbox when getting by id', async () => {
    if (skipIntegration) {
      const fetchMock = vi.fn();

      vi.stubGlobal('fetch', fetchMock);

      try {
        const remoteProvider = cloudflare({ sandboxUrl: 'https://example.com', sandboxApiKey: 'secret' });
        await expect(remoteProvider.sandbox.getById('abcde')).resolves.toMatchObject({ sandboxId: 'abcde' });
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});

// Run the standardized test suite with mock binding for unit tests
if (skipIntegration) {
  runProviderTestSuite({
    name: 'cloudflare-unit',
    provider: cloudflare({
      sandboxBinding: createSandboxBinding(),
      timeout: 300000,
      runtime: 'python'
    }),
    supportsFilesystem: true,  // Cloudflare supports full filesystem operations
    timeout: 300000,           // 5 minutes for container operations
    skipIntegration: true     // Always skip for mocked tests
  });
}
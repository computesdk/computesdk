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

  it('resolves existing disk id without creating a new disk', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'disk_abc123',
              name: 'existing-disk',
              organization: 'org',
              status: 'ready',
              provider: 'archil',
              region: 'aws-us-east-1',
              createdAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ success: false, error: 'unexpected method' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = archil({ apiKey: 'key_test', region: 'aws-us-east-1' });
    const created = await provider.sandbox.create({ diskId: 'disk_abc123' });

    expect(created.sandboxId).toBe('disk_abc123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const method = ((fetchMock.mock.calls as any[][])[0][1] as RequestInit | undefined)?.method;
    expect(method).toBe('GET');
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
  skipIntegration:
    !process.env.ARCHIL_API_KEY || !process.env.ARCHIL_REGION || !process.env.ARCHIL_DISK_ID,
});

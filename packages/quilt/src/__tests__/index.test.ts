import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';

import { quilt } from '../index';

runProviderTestSuite({
  name: 'quilt',
  provider: quilt({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  skipIntegration: !process.env.QUILT_BASE_URL || (!process.env.QUILT_API_KEY && !process.env.QUILT_ACCESS_TOKEN),
});

describe('quilt provider unit behavior', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.QUILT_BASE_URL = 'https://quilt.example.test';
    process.env.QUILT_API_KEY = 'test-key';
    process.env.QUILT_TENANT_ID = 'tenant_123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('runs commands through the Quilt exec API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            container_id: 'ctr_123',
            state: 'running',
            created_at: '2026-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stdout: 'hello\n',
            stderr: '',
            exit_code: 0,
            timed_out: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const provider = quilt({});
    const sandbox = await provider.sandbox.getById('ctr_123');
    expect(sandbox).not.toBeNull();

    const result = await sandbox!.runCommand('echo hello', {
      cwd: '/workspace',
      env: { APP_ENV: 'test' },
    });

    expect(result.stdout).toBe('hello\n');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://quilt.example.test/api/containers/ctr_123/exec',
      expect.objectContaining({
        method: 'POST',
      })
    );
    const execInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(execInit.body))).toMatchObject({
      command: ['/bin/sh', '-lc', 'APP_ENV="test" echo hello'],
      workdir: '/workspace',
    });
  });

  it('reuses or creates published services for getUrl', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            container_id: 'ctr_123',
            state: 'running',
            created_at: '2026-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ services: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            service_id: 'lnx_123',
            public_url: 'https://quilt.example.test/linx/lnx_123/',
            websocket_url: 'wss://quilt.example.test/linx/lnx_123/ws',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const provider = quilt({});
    const handle = await provider.sandbox.getById('ctr_123');
    const url = await handle!.getUrl({ port: 3000, protocol: 'wss' });

    expect(url).toBe('wss://quilt.example.test/linx/lnx_123/ws');
  });

  it('creates snapshots with the required tenant header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            operation_id: 'op_123',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            operation_id: 'op_123',
            status: 'succeeded',
            snapshot_id: 'snap_123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            snapshot_id: 'snap_123',
            source_container_id: 'ctr_123',
            created_at: 1774700001,
            labels: { branch: 'main' },
            pinned: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const provider = quilt({});
    const snapshot = await provider.snapshot!.create('ctr_123', {
      name: 'baseline',
      metadata: { branch: 'main' },
    });

    expect(snapshot.id).toBe('snap_123');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Tenant-Id')).toBe('tenant_123');
  });

  it('fails clearly when snapshot create returns no operation id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const provider = quilt({});

    await expect(
      provider.snapshot!.create('ctr_123', {
        name: 'baseline',
      })
    ).rejects.toThrow('Quilt snapshot create did not return an operation_id.');
  });
});

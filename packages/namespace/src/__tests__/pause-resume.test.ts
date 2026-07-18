import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { namespace, mapStatus } from '../index';

function jsonResponse(body: any, status = 200) {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body)
    } as Response);
}

function mockFetchSequence(...responses: Array<() => Promise<Response>>): Mock<any[], Promise<Response>> {
  let i = 0;
  return vi.fn((..._args: any[]): Promise<Response> => {
    const resp = responses[i++];
    if (!resp) throw new Error(`Unexpected fetch call #${i}`);
    return resp();
  }) as Mock<any[], Promise<Response>>;
}

describe('namespace mapStatus', () => {
  it('maps InstanceMetadata.Status to SandboxInfo status', () => {
    expect(mapStatus(3)).toBe('running');
    expect(mapStatus(7)).toBe('paused');
    expect(mapStatus(6)).toBe('paused');
    expect(mapStatus(4)).toBe('stopped');
    expect(mapStatus(5)).toBe('stopped');
    expect(mapStatus(8)).toBe('error');
    expect(mapStatus(1)).toBe('running');
    expect(mapStatus(2)).toBe('running');
    expect(mapStatus('7')).toBe('paused');
  });
});

describe('namespace pause/resume', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('pauses and resumes via SuspendInstance/WakeInstance', async () => {
    const fetch = mockFetchSequence(
      // create -> CreateInstance
      jsonResponse({
        metadata: { instanceId: 'inst-123' },
        extendedMetadata: { commandServiceEndpoint: 'https://cmd.example' }
      }),
      // pause -> SuspendInstance
      jsonResponse({}),
      // pause -> DescribeInstance poll
      jsonResponse({ metadata: { instanceId: 'inst-123', status: 7 } }),
      // resume -> WakeInstance
      jsonResponse({}),
      // resume -> DescribeInstance poll
      jsonResponse({
        metadata: { instanceId: 'inst-123', status: 3 },
        extendedMetadata: { commandServiceEndpoint: 'https://cmd.example' }
      })
    );
    globalThis.fetch = fetch;

    const provider = namespace({ token: 'test-token' });
    const sandbox = await provider.sandbox.create();
    expect(fetch).toHaveBeenCalledTimes(1);

    await sandbox.pause!();
    expect(fetch).toHaveBeenCalledTimes(3);
    const suspendCall = fetch.mock.calls[1];
    expect(suspendCall[0]).toContain('SuspendInstance');
    expect(JSON.parse(suspendCall[1].body as string)).toEqual({ instance_id: 'inst-123' });

    await sandbox.resume!();
    expect(fetch).toHaveBeenCalledTimes(5);
    const wakeCall = fetch.mock.calls[3];
    expect(wakeCall[0]).toContain('WakeInstance');
    expect(JSON.parse(wakeCall[1].body as string)).toEqual({ instance_id: 'inst-123' });
  });

  it('rejects keepMemory: false', async () => {
    const fetch = mockFetchSequence(
      jsonResponse({
        metadata: { instanceId: 'inst-123' },
        extendedMetadata: { commandServiceEndpoint: 'https://cmd.example' }
      })
    );
    globalThis.fetch = fetch;

    const provider = namespace({ token: 'test-token' });
    const sandbox = await provider.sandbox.create();
    await expect(sandbox.pause!({ keepMemory: false })).rejects.toThrow(
      'Namespace does not support filesystem-only pause'
    );
  });

  it('getInfo reflects paused status', async () => {
    const fetch = mockFetchSequence(
      jsonResponse({
        metadata: { instanceId: 'inst-123' },
        extendedMetadata: { commandServiceEndpoint: 'https://cmd.example' }
      }),
      jsonResponse({ metadata: { instanceId: 'inst-123', status: 7 } })
    );
    globalThis.fetch = fetch;

    const provider = namespace({ token: 'test-token' });
    const sandbox = await provider.sandbox.create();
    const info = await sandbox.getInfo();
    expect(info.status).toBe('paused');
  });
});

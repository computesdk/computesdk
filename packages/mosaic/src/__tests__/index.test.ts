import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from 'computesdk';
import { mosaic } from '../index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Mosaic ComputeSDK provider', () => {
  it('measures the public ComputeSDK create and runCommand path', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method || 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/v1/sandboxes') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'sbx-1', state: 'running', tti_ms: 11 }));
      }
      if (url.endsWith('/v1/sandboxes/sbx-1/exec')) {
        return new Response(JSON.stringify({ stdout: 'v20.11.0\n', stderr: '', exit_code: 0, tti_ms: 18 }));
      }
      if (url.endsWith('/v1/sandboxes/sbx-1') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const sdk = compute({
      provider: mosaic({ baseUrl: 'https://sandbox.example.test', apiKey: 'secret' }),
    });
    const sandbox = await sdk.sandbox.create({ templateId: 'node-20', memoryMb: 4096, vcpus: 2 });
    const result = await sandbox.runCommand('node -v');
    await sandbox.destroy();

    expect(result.stdout).toBe('v20.11.0\n');
    expect(result.exitCode).toBe(0);
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ['POST', '/v1/sandboxes'],
      ['POST', '/v1/sandboxes/sbx-1/exec'],
      ['DELETE', '/v1/sandboxes/sbx-1'],
    ]);
    expect(calls[0].body).toEqual({
      template: 'node-20', memory_mb: 4096, vcpu: 2, enable_ssh: false, network_enabled: false,
    });
  });

  it('maps ComputeSDK runtime and resource options', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'sbx-python', state: 'running', tti_ms: 1 }));
    }) as typeof fetch;

    const provider = mosaic({ baseUrl: 'https://sandbox.example.test' });
    await provider.sandbox.create({ runtime: 'python', memoryMiB: 2048, cpus: 1 });

    expect(body).toEqual({
      template: 'python-3.11', memory_mb: 2048, vcpu: 1, enable_ssh: false, network_enabled: false,
    });
  });
});

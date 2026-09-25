import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIME_DEFAULTS, prime } from '../index.js';

interface CapturedRequest {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBody(init?: RequestInit): Record<string, unknown> | undefined {
  if (typeof init?.body !== 'string') return undefined;
  return JSON.parse(init.body) as Record<string, unknown>;
}

function connectFrame(payload: unknown, flags = 0): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const frame = new Uint8Array(body.length + 5);
  frame[0] = flags;
  new DataView(frame.buffer).setUint32(1, body.length);
  frame.set(body, 5);
  return frame;
}

function connectStreamResponse(...events: unknown[]): Response {
  const frames = [...events.map((event) => connectFrame(event)), connectFrame({ metadata: {} }, 2)];
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const frame of frames) {
    body.set(frame, offset);
    offset += frame.length;
  }
  return new Response(body, { headers: { 'Content-Type': 'application/connect+json' } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@computesdk/prime', () => {
  it('creates a ready sandbox with the benchmark defaults and executes commands', async () => {
    const requests: CapturedRequest[] = [];
    let commandCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: parseBody(init) });

      if (url === 'https://api.test/api/v1/sandbox' && method === 'POST') {
        return jsonResponse({
          id: 'sb_1',
          status: 'PENDING',
          vm: true,
          created_at: '2026-08-12T12:00:00Z',
        });
      }
      if (url === 'https://api.test/api/v1/sandbox/sb_1' && method === 'GET') {
        return jsonResponse({
          id: 'sb_1',
          status: 'RUNNING',
          vm: true,
          created_at: '2026-08-12T12:00:00Z',
          docker_image: PRIME_DEFAULTS.image,
        });
      }
      if (url === 'https://api.test/api/v1/sandbox/sb_1/auth' && method === 'POST') {
        return jsonResponse({
          gateway_url: 'https://gateway.test',
          user_ns: 'users/test',
          job_id: 'job_1',
          token: 'gateway-token',
          expires_at: '2099-01-01T00:00:00Z',
        });
      }
      if (url === 'https://gateway.test/users/test/job_1/command_session.CommandSession/Start' && method === 'POST') {
        commandCount += 1;
        const stdout = Buffer.from(commandCount === 1 ? 'sandbox ready\n' : 'v22.0.0\n').toString('base64');
        return connectStreamResponse(
          { event: { data: { stdout } } },
          { event: { end: { exitCode: 0, exited: true, status: 'exited' } } },
        );
      }
      if (url === 'https://api.test/api/v1/sandbox/sb_1' && method === 'DELETE') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({ detail: `Unexpected request: ${method} ${url}` }, 500);
    }) as unknown as typeof fetch;

    const provider = prime({
      apiKey: 'prime-test-key',
      baseUrl: 'https://api.test/api/v1',
      readinessPollIntervalMs: 0,
      fetch: fetchMock,
    });

    const sandbox = await provider.sandbox.create({
      image: 'node:22-bookworm',
    });
    const result = await sandbox.runCommand('node -v', {
      cwd: '/workspace',
      env: { NODE_ENV: 'test' },
      timeout: 30_001,
    });
    await sandbox.destroy();

    const create = requests.find((request) => request.url.endsWith('/api/v1/sandbox') && request.method === 'POST');
    expect(create?.body).toMatchObject({
      docker_image: 'node:22-bookworm',
      cpu_cores: 1,
      memory_gb: 1,
      disk_size_gb: 10,
      timeout_minutes: 60,
      vm: true,
      start_command: null,
    });

    const commandRequests = requests.filter((request) => request.url.endsWith('/command_session.CommandSession/Start'));
    expect(commandRequests).toHaveLength(2);
    expect(result).toMatchObject({ stdout: 'v22.0.0\n', stderr: '', exitCode: 0 });
    expect(requests.filter((request) => request.url.endsWith('/auth'))).toHaveLength(1);
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://api.test/api/v1/sandbox/sb_1' });
  });

  it('deletes a sandbox when readiness fails', async () => {
    const requests: CapturedRequest[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: parseBody(init) });
      if (url.endsWith('/api/v1/sandbox') && method === 'POST') {
        return jsonResponse({ id: 'sb_failed', status: 'PENDING' });
      }
      if (url.endsWith('/api/v1/sandbox/sb_failed') && method === 'GET') {
        return jsonResponse({
          id: 'sb_failed',
          status: 'ERROR',
          error_message: 'image pull failed',
        });
      }
      if (url.endsWith('/api/v1/sandbox/sb_failed') && method === 'DELETE') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({ detail: 'unexpected request' }, 500);
    }) as unknown as typeof fetch;

    const provider = prime({
      apiKey: 'prime-test-key',
      baseUrl: 'https://api.test',
      readinessPollIntervalMs: 0,
      fetch: fetchMock,
    });

    await expect(provider.sandbox.create()).rejects.toThrow('image pull failed');
    expect(requests.at(-1)).toMatchObject({
      method: 'DELETE',
      url: 'https://api.test/api/v1/sandbox/sb_failed',
    });
  });

  it('requires a Prime API key before making a request', async () => {
    const previous = process.env.PRIME_API_KEY;
    delete process.env.PRIME_API_KEY;
    try {
      const fetchMock = vi.fn() as unknown as typeof fetch;
      const provider = prime({ apiKey: '', baseUrl: 'https://api.test', fetch: fetchMock });
      await expect(provider.sandbox.create()).rejects.toThrow('Missing Prime API key');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.PRIME_API_KEY;
      else process.env.PRIME_API_KEY = previous;
    }
  });
});

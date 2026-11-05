import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

const RUN_COMMAND = 'https://cmd.example.com/namespace.cloud.compute.v1beta.CommandService/RunCommand';

const createdInstance = {
  metadata: { instanceId: 'inst-123' },
  extendedMetadata: { commandServiceEndpoint: 'https://cmd.example.com' },
};

/** One Connect envelope: flag byte, 4-byte big-endian length, JSON payload. */
function frame(message: unknown, flags = 0): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  const out = new Uint8Array(5 + payload.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}
const out = (text: string) => frame({ stream: 'STDOUT', data: Buffer.from(text).toString('base64') });
const err = (text: string) => frame({ stream: 'STDERR', data: Buffer.from(text).toString('base64') });
const exit = (exitCode: number) => frame({ exitStatus: exitCode === 0 ? {} : { exitCode } });
const end = (error?: { code: string; message: string }) => frame(error ? { error } : {}, 0x02);

type Step = Uint8Array | { wait: number } | { fail: Error } | 'hang';

/**
 * Stubs fetch: CreateInstance answers JSON, RunCommand answers a stream that
 * plays `steps` in order (chunks, pauses, a mid-stream failure, or never ending).
 */
function mockNamespace(steps: Step[], init?: { status?: number; body?: string }) {
  const requests: Array<{ headers: Record<string, string>; body: any; signal?: AbortSignal }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, req: any) => {
    if (String(url) !== RUN_COMMAND) return { ok: true, json: async () => createdInstance } as any;
    const raw = req.body as Uint8Array;
    requests.push({
      headers: req.headers,
      body: JSON.parse(new TextDecoder().decode(raw.subarray(5))),
      signal: req.signal,
    });
    if (init?.status) {
      return new Response(init.body ?? '', { status: init.status, statusText: 'Unauthorized' });
    }
    const signal: AbortSignal = req.signal;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        for (const step of steps) {
          if (signal?.aborted) return;
          if (step === 'hang') return;
          if (step instanceof Uint8Array) controller.enqueue(step);
          else if ('wait' in step) await new Promise((r) => setTimeout(r, step.wait));
          else { controller.error(step.fail); return; }
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/connect+json' } });
  }));
  return requests;
}

async function sandbox() {
  return namespace({ token: 'ns_test' }).sandbox.create({} as any);
}

describe('namespace streamCommand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams stdout and stderr chunks in order as they arrive and reports the exit code', async () => {
    const requests = mockNamespace([out('1\n'), { wait: 20 }, err('warn\n'), { wait: 20 }, out('2\n'), exit(3), end()]);
    const sbx = await sandbox();
    const seen: string[] = [];
    const startedAt = Date.now();
    const arrivals: number[] = [];
    const result = await sbx.runCommand('for i in 1 2; do echo $i; done', {
      cwd: '/work',
      env: { A: 'b' },
      onStdout: (t) => { seen.push(`out:${t}`); arrivals.push(Date.now() - startedAt); },
      onStderr: (t) => { seen.push(`err:${t}`); arrivals.push(Date.now() - startedAt); },
    });

    expect(seen).toEqual(['out:1\n', 'err:warn\n', 'out:2\n']);
    expect(arrivals[2] - arrivals[0]).toBeGreaterThanOrEqual(30);
    expect(result).toMatchObject({ stdout: '1\n2\n', stderr: 'warn\n', exitCode: 3 });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['Content-Type']).toBe('application/connect+json');
    expect(requests[0].headers['Connect-Protocol-Version']).toBe('1');
    expect(requests[0].headers['Authorization']).toBe('Bearer ns_test');
    expect(requests[0].headers['Connect-Timeout-Ms']).toBeUndefined();
    expect(requests[0].body).toEqual({
      instanceId: 'inst-123',
      targetContainerName: 'main-container',
      command: { command: ['sh', '-c', 'cd "/work" && A="b" for i in 1 2; do echo $i; done'] },
    });
  });

  it('reads exit 0 from an empty exitStatus and decodes multi-byte characters split across chunks', async () => {
    const euro = Buffer.from('€\n');
    mockNamespace([
      frame({ stream: 1, data: euro.subarray(0, 1).toString('base64') }),
      frame({ stream: 1, data: euro.subarray(1).toString('base64') }),
      exit(0),
      end(),
    ]);
    const sbx = await sandbox();
    const chunks: string[] = [];
    const result = await sbx.runCommand('echo €', { onStdout: (t) => chunks.push(t) });
    expect(chunks.join('')).toBe('€\n');
    expect(result).toMatchObject({ stdout: '€\n', exitCode: 0 });
  });

  it('enforces the timeout: sends Connect-Timeout-Ms, aborts the stream and reports 124', async () => {
    const requests = mockNamespace([out('started\n'), 'hang']);
    const sbx = await sandbox();
    const startedAt = Date.now();
    const result = await sbx.runCommand('sleep 100', { timeout: 150, onStdout: () => {} });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(result).toMatchObject({ stdout: 'started\n', exitCode: 124 });
    expect(requests[0].headers['Connect-Timeout-Ms']).toBe('150');
    expect(requests[0].signal?.aborted).toBe(true);
  });

  it('maps a server deadline_exceeded end-stream to 124', async () => {
    mockNamespace([out('x'), end({ code: 'deadline_exceeded', message: 'deadline exceeded' })]);
    const sbx = await sandbox();
    const result = await sbx.runCommand('sleep 100', { timeout: 60_000, onStdout: () => {} });
    expect(result).toMatchObject({ stdout: 'x', exitCode: 124 });
  });

  it('keeps what streamed and reports -1 when the stream drops mid-command', async () => {
    mockNamespace([out('partial\n'), { wait: 20 }, { fail: new TypeError('terminated') }]);
    const sbx = await sandbox();
    const stderrChunks: string[] = [];
    const result = await sbx.runCommand('long', { onStdout: () => {}, onStderr: (t) => stderrChunks.push(t) });
    expect(result.stdout).toBe('partial\n');
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toBe('terminated');
    expect(stderrChunks.join('')).toBe(result.stderr);
  });

  it('reports -1 when the stream ends cleanly without an exit status', async () => {
    mockNamespace([out('a'), end()]);
    const sbx = await sandbox();
    const result = await sbx.runCommand('x', { onStdout: () => {} });
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('ended without an exit status');
  });

  it('reports an error before any output as a start failure (127) with Namespace\'s message', async () => {
    mockNamespace([end({ code: 'not_found', message: 'instance inst-123 not found' })]);
    const sbx = await sandbox();
    const result = await sbx.runCommand('x', { onStdout: () => {} });
    expect(result).toMatchObject({ stdout: '', exitCode: 127, stderr: 'Namespace API error: not_found: instance inst-123 not found' });
  });

  it('reports a non-200 response as a start failure (127)', async () => {
    mockNamespace([], { status: 401, body: '{"code":"unauthenticated","message":"bad token"}' });
    const sbx = await sandbox();
    const result = await sbx.runCommand('x', { onStdout: () => {} });
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe('Namespace API error: 401 Unauthorized: unauthenticated: bad token');
  });

  it('maps a non-200 deadline_exceeded response to 124 when a timeout was set', async () => {
    mockNamespace([], { status: 408, body: '{"code":"deadline_exceeded","message":"timeout"}' });
    const sbx = await sandbox();
    const result = await sbx.runCommand('x', { timeout: 5000, onStdout: () => {} });
    expect(result.exitCode).toBe(124);
  });

  it('handles frames split across network reads and several frames in one read', async () => {
    const all = new Uint8Array([...out('a'), ...out('b'), ...exit(0), ...end()]);
    mockNamespace([all.subarray(0, 3), all.subarray(3, 9), all.subarray(9)]);
    const sbx = await sandbox();
    const chunks: string[] = [];
    const result = await sbx.runCommand('x', { onStdout: (t) => chunks.push(t) });
    expect(chunks).toEqual(['a', 'b']);
    expect(result).toMatchObject({ stdout: 'ab', exitCode: 0 });
  });
});

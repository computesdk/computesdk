import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNamespace, isNamespaceNotFound } from '../index';

const RUN = '/namespace.cloud.compute.v1beta.CommandService/RunCommandSync';
const DESCRIBE = '/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance';

type Step = { status: number; body?: string } | { throws: unknown };

function mockFetch(steps: Step[]) {
  const spy = vi.fn(async () => {
    const step = steps.shift() ?? { status: 200, body: '{}' };
    if ('throws' in step) throw step.throws;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: step.status === 200 ? 'OK' : step.status === 503 ? 'Service Unavailable' : 'Internal Server Error',
      json: async () => JSON.parse(step.body ?? '{}'),
      text: async () => step.body ?? '',
      body: { cancel: async () => undefined },
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function fetchFailed(code: string) {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
}

describe('fetchNamespace errors and retries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts Namespace\'s error body in the message and does not repeat a command on 500', async () => {
    const spy = mockFetch([{ status: 500, body: '{"code":"internal","message":"instance agent unreachable"}' }]);
    await expect(fetchNamespace('t', RUN, { method: 'POST' })).rejects.toThrow(
      'Namespace API error: 500 Internal Server Error: internal: instance agent unreachable'
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent call on 500', async () => {
    const spy = mockFetch([{ status: 500 }, { status: 200, body: '{"ok":1}' }]);
    await expect(fetchNamespace('t', DESCRIBE, { method: 'POST' })).resolves.toEqual({ ok: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('retries a command only when the connection never opened', async () => {
    const spy = mockFetch([{ throws: fetchFailed('ECONNREFUSED') }, { status: 200, body: '{}' }]);
    await expect(fetchNamespace('t', RUN, { method: 'POST' })).resolves.toEqual({});
    expect(spy).toHaveBeenCalledTimes(2);
    mockFetch([{ status: 503 }]);
    await expect(fetchNamespace('t', RUN, { method: 'POST' })).rejects.toThrow('503');
  });

  it('marks only Namespace\'s own 404 as not found', async () => {
    mockFetch([{ status: 404 }]);
    const notFound = await fetchNamespace('t', RUN, { method: 'POST' }).catch((e) => e);
    expect(isNamespaceNotFound(notFound)).toBe(true);
    mockFetch([{ status: 500, body: '{"code":"internal","message":"upstream 404"}' }]);
    const internal = await fetchNamespace('t', RUN, { method: 'POST' }).catch((e) => e);
    expect(isNamespaceNotFound(internal)).toBe(false);
  });

  it('does not repeat a command whose connection dropped mid-request', async () => {
    const spy = mockFetch([{ throws: fetchFailed('ECONNRESET') }]);
    await expect(fetchNamespace('t', RUN, { method: 'POST' })).rejects.toThrow('fetch failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts', async () => {
    const spy = mockFetch([{ status: 503 }, { status: 503 }, { status: 503 }]);
    await expect(fetchNamespace('t', DESCRIBE, { method: 'POST' })).rejects.toThrow('503');
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

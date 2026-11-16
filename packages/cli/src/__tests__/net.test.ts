import { describe, it, expect, vi } from 'vitest';
import { describeFetchFailure, withFetchFailureContext } from '../net.js';

function fetchFailed(cause: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: new Error(cause) });
}

describe('withFetchFailureContext', () => {
  it('names the URL and the socket error of a failed connection', async () => {
    const wrapped = withFetchFailureContext(vi.fn(async () => {
      throw fetchFailed('connect ECONNREFUSED 127.0.0.1:9');
    }));
    await expect(wrapped('http://127.0.0.1:9/api/v1/benchmarks?limit=5')).rejects.toThrow(
      'fetch failed (http://127.0.0.1:9/api/v1/benchmarks): connect ECONNREFUSED 127.0.0.1:9',
    );
  });

  it('accepts URL and Request inputs', async () => {
    const wrapped = withFetchFailureContext(vi.fn(async () => {
      throw fetchFailed('getaddrinfo ENOTFOUND nowhere.test');
    }));
    await expect(wrapped(new URL('https://nowhere.test/a'))).rejects.toThrow('(https://nowhere.test/a)');
    await expect(wrapped(new Request('https://nowhere.test/b'))).rejects.toThrow('(https://nowhere.test/b)');
  });

  it('passes responses and other errors through untouched', async () => {
    const ok = new Response('ok');
    expect(await withFetchFailureContext(vi.fn(async () => ok))('http://localhost/')).toBe(ok);
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      withFetchFailureContext(vi.fn(async () => {
        throw abort;
      }))('http://localhost/'),
    ).rejects.toBe(abort);
  });
});

describe('describeFetchFailure', () => {
  it('omits the cause when there is none', () => {
    expect(describeFetchFailure(new TypeError('fetch failed'), 'http://localhost:3210/x').message).toBe(
      'fetch failed (http://localhost:3210/x)',
    );
  });
});

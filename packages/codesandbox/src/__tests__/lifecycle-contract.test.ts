import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeSandbox, Sandbox } from '@codesandbox/sdk';
import { codesandbox } from '../index';

// Exercise the installed native SDK and real provider factory. Only HTTP is
// controlled: no canned framework sandbox or replacement native methods.
const id = 'owned-unit-id';
const nativeDetail = 'native-detail-do-not-forward';
const lookupFailure = 'Failed to get CodeSandbox sandbox.';
const deleteFailure = 'Failed to delete CodeSandbox sandbox.';
const apiKey = 'csb_unit_only';
type Call = { method: string; path: string };
let calls: Call[];
let wireRequests: Request[];
let respond: (call: Call) => Response | Promise<Response>;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const metadata = (canonicalId = id) => json(200, { data: {
  id: canonicalId, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', privacy: 2, tags: [],
} });
const running = () => json(200, { data: {
  id, bootup_type: 'RUNNING', cluster: 'unit', pitcher_url: '',
  workspace_path: '/project/sandbox', user_workspace_path: '/project/sandbox',
  pitcher_manager_version: 'unit', pitcher_version: 'unit',
  latest_pitcher_version: 'unit', pitcher_token: 'unit',
} });
const failure = (status: number) => json(status, { errors: [nativeDetail] });
const getCall = { method: 'GET', path: `/sandbox/${id}` };
const resumeCall = { method: 'POST', path: `/vm/${id}/start` };
const deleteCall = { method: 'DELETE', path: `/vm/${id}` };
const provider = () => codesandbox({ apiKey });

async function rejectsSafely(promise: Promise<unknown>, message: string) {
  const error = await promise.catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message });
  expect(error).not.toHaveProperty('cause');
}

beforeEach(() => {
  calls = [];
  wireRequests = [];
  vi.stubEnv('CSB_BASE_URL', '');
  respond = call => {
    if (call.method === 'GET') return metadata();
    if (call.path.endsWith('/start')) return running();
    return json(200, { data: {} });
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const call = { method: request.method, path: new URL(request.url).pathname };
    calls.push(call);
    wireRequests.push(request);
    const response = await respond(call);
    // Model the wire behavior of fetch: 307/308 retain the method and can
    // mutate a different resource unless redirect policy is set BEFORE fetch.
    const location = response.headers.get('Location');
    if ([307, 308].includes(response.status) && location && request.redirect === 'follow') {
      const next = new Request(new URL(location, request.url), request);
      const nextCall = { method: next.method, path: new URL(next.url).pathname };
      calls.push(nextCall);
      wireRequests.push(next);
      return Object.defineProperty(await respond(nextCall), 'redirected', { value: true });
    }
    return response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('CodeSandbox native lifecycle HTTP contract', () => {
  it('documents that SDK 2.4.2 erases a real metadata HTTP 404 into an untyped error', async () => {
    respond = () => failure(404);
    const error = await new CodeSandbox(apiKey).sandboxes.get(id).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(`Failed to get sandbox ${id}: Sandbox not found`);
    expect(error.status).toBeUndefined();
    expect(error.response).toBeUndefined();
    expect(calls).toEqual([getCall]);
  });

  it('checks canonical metadata before resuming and retains a usable native handle', async () => {
    const found = await provider().sandbox.getById(id);
    expect(found?.sandboxId).toBe(id);
    expect(found?.getInstance()).toBeInstanceOf(Sandbox);
    expect(calls).toEqual([getCall, resumeCall]);
  });

  it('sets manual redirects before every metadata, resume and delete request while preserving native headers and body', async () => {
    const manager = provider().sandbox;
    await manager.getById(id);
    await manager.destroy(id);
    expect(calls).toEqual([getCall, resumeCall, deleteCall]);
    expect(wireRequests.map(request => request.redirect)).toEqual(['manual', 'manual', 'manual']);
    expect(wireRequests.every(request => request.headers.get('Authorization') === `Bearer ${apiKey}`)).toBe(true);
    expect(await wireRequests[1].clone().text()).toBe('{}');
  });

  it.each([
    ['GET', 307], ['GET', 308], ['DELETE', 307], ['DELETE', 308],
  ] as const)('rejects initial %s HTTP %i before following or mutating another resource', async (method, status) => {
    let otherResourceRequests = 0;
    const initial = method === 'GET' ? getCall : deleteCall;
    respond = call => {
      if (call.path === initial.path) {
        return new Response(JSON.stringify({ errors: [nativeDetail] }), {
          status,
          headers: {
            'Content-Type': 'application/json',
            Location: method === 'GET' ? '/sandbox/someone-elses-id' : '/vm/someone-elses-id',
          },
        });
      }
      otherResourceRequests++;
      return method === 'GET' ? metadata() : json(200, { data: {} });
    };
    const manager = provider().sandbox;
    await rejectsSafely(
      method === 'GET' ? manager.getById(id) : manager.destroy(id),
      method === 'GET' ? lookupFailure : deleteFailure,
    );
    expect(calls).toEqual([initial]);
    expect(wireRequests.map(request => request.redirect)).toEqual(['manual']);
    expect(otherResourceRequests).toBe(0);
  });

  it('returns null only for a real metadata HTTP 404, without resuming', async () => {
    respond = call => call.method === 'GET' ? failure(404) : running();
    await expect(provider().sandbox.getById(id)).resolves.toBeNull();
    expect(calls).toEqual([getCall]);
  });

  it.each([401, 403, 429, 500, 502, 503])('rejects metadata HTTP %i with a fixed safe error, never null', async status => {
    respond = call => call.method === 'GET' ? failure(status) : running();
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall]);
  });

  it.each([
    new TypeError(nativeDetail),
    new Error('Sandbox not found 404'),
    { status: 404, response: { status: 404 }, message: nativeDetail },
  ])('does not treat a network error or forged error status/message as metadata absence', async error => {
    respond = () => { throw error; };
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall]);
  });

  it('rejects a different canonical ID before resuming it or the caller ID', async () => {
    respond = call => call.method === 'GET' ? metadata('someone-elses-id') : running();
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall]);
  });

  it('does not classify an HTTP 500 body mentioning absence as a metadata 404', async () => {
    respond = () => json(500, { errors: ['Sandbox not found 404'] });
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall]);
  });

  it('does not classify a redirected HTTP 404 as absence at the requested metadata endpoint', async () => {
    respond = () => Object.defineProperty(failure(404), 'redirected', { value: true });
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall]);
  });

  it.each([404, 403, 500])('rejects resume HTTP %i even after a successful metadata lookup', async status => {
    respond = call => call.method === 'GET' ? metadata() : failure(status);
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall, resumeCall, resumeCall, resumeCall]);
  });

  it('does not mistake a resume transport failure for absence', async () => {
    respond = call => {
      if (call.method === 'GET') return metadata();
      throw new Error(nativeDetail);
    };
    await rejectsSafely(provider().sandbox.getById(id), lookupFailure);
    expect(calls).toEqual([getCall, resumeCall, resumeCall, resumeCall]);
  });

  it.each(['', '.', '..', '../other', 'id/other', 'id?other', 'id#other', 'id%2fother', ' id', 'id\n'])(
    'rejects a noncanonical path ID before any lookup or destructive request (%j)', async invalidId => {
      await rejectsSafely(provider().sandbox.getById(invalidId), 'Invalid CodeSandbox sandbox ID.');
      await rejectsSafely(provider().sandbox.destroy(invalidId), 'Invalid CodeSandbox sandbox ID.');
      expect(calls).toEqual([]);
    },
  );

  it('uses only the public permanent delete operation for the exact supplied ID', async () => {
    await expect(provider().sandbox.destroy(id)).resolves.toBeUndefined();
    expect(calls).toEqual([deleteCall]);
  });

  it('accepts a real DELETE HTTP 404 as an idempotent delete, not a message match', async () => {
    respond = () => failure(404);
    await expect(provider().sandbox.destroy(id)).resolves.toBeUndefined();
    expect(calls).toEqual([deleteCall]);
  });

  it.each([401, 403, 429, 500, 502, 503])('rejects DELETE HTTP %i with a fixed safe error', async status => {
    respond = () => failure(status);
    await rejectsSafely(provider().sandbox.destroy(id), deleteFailure);
    expect(calls).toEqual([deleteCall]);
  });

  it('does not swallow a DELETE HTTP 500 body mentioning not found or 404', async () => {
    respond = () => json(500, { errors: ['not found 404'] });
    await rejectsSafely(provider().sandbox.destroy(id), deleteFailure);
    expect(calls).toEqual([deleteCall]);
  });

  it('does not invent an SDK acknowledgement when the native success envelope is missing', async () => {
    respond = () => json(200, {});
    await rejectsSafely(provider().sandbox.destroy(id), deleteFailure);
    expect(calls).toEqual([deleteCall]);
  });

  it.each([
    new TypeError(nativeDetail),
    new Error('not found 404'),
    { status: 404, response: { status: 404 }, message: nativeDetail },
  ])('does not acknowledge a failed DELETE based on error text/status alone', async error => {
    respond = () => { throw error; };
    await rejectsSafely(provider().sandbox.destroy(id), deleteFailure);
    expect(calls).toEqual([deleteCall]);
  });

  it('does not turn a DELETE acknowledgement into invented absence', async () => {
    const manager = provider().sandbox;
    await manager.destroy(id);
    const found = await manager.getById(id);
    expect(found?.sandboxId).toBe(id);
    expect(calls).toEqual([deleteCall, getCall, resumeCall]);
  });

  it('observes metadata absence separately after a DELETE acknowledgement', async () => {
    let deleted = false;
    respond = call => {
      if (call.method === 'DELETE') {
        deleted = true;
        return json(200, { data: {} });
      }
      return deleted ? failure(404) : metadata();
    };
    const manager = provider().sandbox;
    await manager.destroy(id);
    await expect(manager.getById(id)).resolves.toBeNull();
    expect(calls).toEqual([deleteCall, getCall]);
  });

  it('keeps an unresolved metadata request unresolved rather than returning null', async () => {
    let release!: (response: Response) => void;
    respond = () => new Promise<Response>(resolve => { release = resolve; });
    const result = provider().sandbox.getById(id);
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(settled).toBe(false);
    expect(calls).toEqual([getCall]);
    release(failure(404));
    await expect(result).resolves.toBeNull();
  });
});

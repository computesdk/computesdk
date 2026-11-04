import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { CodeSandbox, Sandbox } from '@codesandbox/sdk';
import { codesandbox, CodeSandboxLifecycleError } from '../index';

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

async function rejectsLifecycle(
  promise: Promise<unknown>, operation: 'get' | 'resume' | 'delete', httpStatus?: number,
) {
  const error = await promise.catch(error => error);
  expect(error).toBeInstanceOf(CodeSandboxLifecycleError);
  if (!(error instanceof Error)) throw new Error('Expected a lifecycle failure.');
  expect(error).toMatchObject({
    name: 'CodeSandboxLifecycleError',
    code: 'CODESANDBOX_LIFECYCLE_ERROR',
    provider: 'codesandbox',
    operation,
    message: operation === 'delete' ? deleteFailure : lookupFailure,
  });
  if (httpStatus === undefined) expect(error).not.toHaveProperty('httpStatus');
  else expect(error).toHaveProperty('httpStatus', httpStatus);
  expect(Object.keys(error).sort()).toEqual(
    ['name', 'code', 'provider', 'operation', ...(httpStatus === undefined ? [] : ['httpStatus'])].sort(),
  );
  for (const field of ['cause', 'config', 'response', 'body', 'request', 'status']) {
    expect(error).not.toHaveProperty(field);
  }
  expect(JSON.stringify(error)).not.toContain(nativeDetail);
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
  it.each([99, 600, 200.5, NaN, Infinity])('omits an invalid diagnostic HTTP status (%s)', status => {
    expect(new CodeSandboxLifecycleError('delete', status)).not.toHaveProperty('httpStatus');
  });

  it.each([100, 599])('retains an integer diagnostic HTTP status at the valid boundary (%i)', status => {
    expect(new CodeSandboxLifecycleError('delete', status)).toHaveProperty('httpStatus', status);
  });

  it.each(['get', 'resume', 'delete'] as const)(
    'reports only the scoped native HTTP status for %s failures', async operation => {
      respond = call => {
        if (operation === 'resume' && call.method === 'GET') return metadata();
        return failure(403);
      };
      const manager = provider().sandbox;
      await rejectsLifecycle(
        operation === 'delete' ? manager.destroy(id) : manager.getById(id), operation, 403,
      );
      expect(calls).toEqual(
        operation === 'delete' ? [deleteCall]
          : operation === 'get' ? [getCall] : [getCall, resumeCall, resumeCall, resumeCall],
      );
    },
  );

  it.each(['get', 'resume', 'delete'] as const)(
    'does not infer %s HTTP status from thrown objects or a prior metadata success', async operation => {
      respond = call => {
        if (operation === 'resume' && call.method === 'GET') return metadata();
        throw { status: 404, httpStatus: 404, response: { status: 404 }, message: nativeDetail };
      };
      const manager = provider().sandbox;
      await rejectsLifecycle(
        operation === 'delete' ? manager.destroy(id) : manager.getById(id), operation,
      );
    },
  );

  it('drops an earlier resume HTTP status when the last SDK retry has a transport error', async () => {
    let resumes = 0;
    respond = call => {
      if (call.method === 'GET') return metadata();
      if (++resumes < 3) return failure(503);
      throw new TypeError(nativeDetail);
    };
    await rejectsLifecycle(provider().sandbox.getById(id), 'resume');
    expect(calls).toEqual([getCall, resumeCall, resumeCall, resumeCall]);
  });

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

// A local protocol peer drives the genuine public Sandbox.connect and
// SandboxClient implementations. No native methods/prototypes are replaced.
// Only the MessagePack primitives used by these controlled frames are needed.
function encodeFrame(value: any): Buffer {
  const length = (tag: number, size: number) => {
    const header = Buffer.alloc(5);
    header[0] = tag;
    header.writeUInt32BE(size, 1);
    return header;
  };
  if (value === null || value === undefined) return Buffer.from([0xc0]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0xc3 : 0xc2]);
  if (typeof value === 'number') {
    const data = Buffer.alloc(5);
    data[0] = 0xd2;
    data.writeInt32BE(value, 1);
    return data;
  }
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const data = Buffer.from(value);
    return Buffer.concat([length(typeof value === 'string' ? 0xdb : 0xc6, data.length), data]);
  }
  if (Array.isArray(value)) return Buffer.concat([length(0xdd, value.length), ...value.map(encodeFrame)]);
  const entries = Object.entries(value);
  return Buffer.concat([length(0xdf, entries.length), ...entries.flatMap(([key, entry]) => [
    encodeFrame(key), encodeFrame(entry),
  ])]);
}

function decodeFrame(data: Buffer): any {
  let offset = 0;
  const count = (bytes: number) => {
    const value = data.readUIntBE(offset, bytes);
    offset += bytes;
    return value;
  };
  const text = (size: number) => {
    const value = data.toString('utf8', offset, offset + size);
    offset += size;
    return value;
  };
  const array = (size: number): any[] => Array.from({ length: size }, read);
  const map = (size: number): Record<string, any> => Object.fromEntries(
    Array.from({ length: size }, () => [read(), read()]),
  );
  function read(): any {
    const tag = count(1);
    if (tag < 0x80) return tag;
    if (tag >= 0xe0) return tag - 256;
    if (tag >= 0xa0 && tag <= 0xbf) return text(tag & 31);
    if (tag >= 0x90 && tag <= 0x9f) return array(tag & 15);
    if (tag >= 0x80 && tag <= 0x8f) return map(tag & 15);
    if (tag === 0xc0) return null;
    if (tag === 0xc2 || tag === 0xc3) return tag === 0xc3;
    if (tag >= 0xcc && tag <= 0xce) return count(2 ** (tag - 0xcc));
    if (tag >= 0xd9 && tag <= 0xdb) return text(count(2 ** (tag - 0xd9)));
    if (tag === 0xdc || tag === 0xdd) return array(count(tag === 0xdc ? 2 : 4));
    if (tag === 0xde || tag === 0xdf) return map(count(tag === 0xde ? 2 : 4));
    if (tag >= 0xc4 && tag <= 0xc6) {
      const size = count(2 ** (tag - 0xc4));
      const value = data.subarray(offset, offset + size);
      offset += size;
      return value;
    }
    throw new Error('Unsupported controlled protocol frame.');
  }
  return read();
}

describe('adapter-owned native client lifetime over a local WebSocket peer', () => {
  let server: any;
  let connections: { opened: number; closed: number };
  let failRead: boolean;
  let methods: string[];

  beforeEach(async () => {
    const nativeRequire = createRequire(require.resolve('@codesandbox/sdk'));
    const { WebSocketServer } = nativeRequire('isomorphic-ws');
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    connections = { opened: 0, closed: 0 };
    const observedConnections = connections;
    failRead = false;
    methods = [];
    const observedMethods = methods;
    server.on('connection', (socket: any) => {
      observedConnections.opened++;
      socket.on('close', () => { observedConnections.closed++; });
      socket.on('message', (bytes: Buffer) => {
        if (bytes.length === 0) { socket.send(''); return; }
        const request = decodeFrame(bytes);
        observedMethods.push(request.method);
        const send = (value: unknown) => socket.send(encodeFrame(value));
        const reply = (result: unknown) => send({
          id: request.id, method: request.method, status: 0, result,
        });
        switch (request.method) {
          case 'client/join':
            reply({ client: { username: 'unit' }, reconnectToken: 'unit' });
            break;
          case 'setup/get':
            reply({ state: 'FINISHED', currentStepIndex: 1, steps: [
              { name: 'unit', command: '', shellId: null, finishStatus: 'SUCCEEDED' },
            ] });
            break;
          case 'fs/readFile':
            if (failRead) {
              send({ id: request.id, method: request.method, status: 1, error: {
                code: 102, message: 'controlled-operation-failed', data: { errno: 2 },
              } });
            } else reply({ content: new TextEncoder().encode('{}') });
            break;
          case 'fs/readdir':
            reply({ entries: [] });
            break;
          case 'port/list':
            reply({ list: [] });
            break;
          case 'shell/create': {
            reply({ shellId: 'unit-shell', shellType: 'COMMAND', status: 'RUNNING', buffer: [] });
            const delimiter = request.params.command.match(/__COMPUTESDK_EXIT_\d+_[a-z0-9]+__/);
            setTimeout(() => {
              send({ method: 'shell/out', params: {
                shellId: 'unit-shell', out: `complete-output\n${delimiter?.[0] || ''}0\n`,
              } });
              send({ method: 'shell/exit', params: { shellId: 'unit-shell', exitCode: 0 } });
            }, 10);
            break;
          }
          default:
            reply({});
        }
      });
    });
    await once(server, 'listening');
    const originalRespond = respond;
    respond = async call => {
      if (!call.path.endsWith('/start')) return originalRespond(call);
      const body = await running().json();
      body.data.pitcher_url = `ws://127.0.0.1:${server.address().port}`;
      return json(200, body);
    };
  });

  afterEach(async () => {
    // Silence automatic reconnect in RED runs before closing the local peer:
    // hibernation is a controlled protocol notification, not a provider API call.
    for (const socket of server.clients) {
      socket.send(encodeFrame({ method: 'system/hibernate', params: {} }));
    }
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('releases the client opened by getById egress hydration before permanent delete', async () => {
    const manager = provider().sandbox;
    const found = await manager.getById(id);
    expect(found?.sandboxId).toBe(id);
    await vi.waitFor(() => expect(connections.closed).toBe(connections.opened), { timeout: 300 });
    expect(connections.opened).toBe(1);
    await manager.destroy(id);
    expect(calls).toEqual([getCall, resumeCall, deleteCall]);
    expect(methods).toContain('fs/readFile');
  });

  it.each(['readFile', 'writeFile', 'mkdir', 'readdir', 'exists', 'remove', 'runCommand'] as const)(
    'releases the native client after awaited %s output is collected', async operation => {
      const found = (await provider().sandbox.getById(id))!;
      if (operation === 'runCommand') {
        const result = await found.runCommand('printf complete-output');
        expect(result.stdout).toBe('complete-output');
        expect(result.exitCode).toBe(0);
      } else if (operation === 'writeFile') {
        await found.filesystem.writeFile('/unit', 'data');
      } else {
        await found.filesystem[operation]('/unit');
      }
      await vi.waitFor(() => expect(connections.closed).toBe(connections.opened), { timeout: 300 });
      expect(connections.opened).toBe(2);
      expect(methods).not.toContain('shell/terminate');
    },
  );

  it('releases a native client when its filesystem operation rejects, preserving the operation error', async () => {
    const found = (await provider().sandbox.getById(id))!;
    failRead = true;
    await expect(found.filesystem.readFile('/unit')).rejects.toThrow('2: controlled-operation-failed');
    await vi.waitFor(() => expect(connections.closed).toBe(connections.opened), { timeout: 300 });
  });

  it('does not close a raw client opened through the public native escape hatch', async () => {
    const found = (await provider().sandbox.getById(id))!;
    const rawClient = await (found.getInstance() as Sandbox).connect();
    try {
      await found.filesystem.readFile('/unit');
      await vi.waitFor(() => expect(connections.closed).toBe(connections.opened - 1), { timeout: 300 });
      expect(rawClient.state).toBe('CONNECTED');
    } finally {
      rawClient.dispose();
    }
  });

  it('collects the returned nohup command result before disconnecting without terminating its shell', async () => {
    const found = (await provider().sandbox.getById(id))!;
    const result = await found.runCommand('printf complete-output', { background: true });
    expect(result.stdout).toBe('complete-output');
    expect(result.exitCode).toBe(0);
    await vi.waitFor(() => expect(connections.closed).toBe(connections.opened), { timeout: 300 });
    expect(methods).not.toContain('shell/terminate');
  });
});

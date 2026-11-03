import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerHttp2Session } from 'node:http2';
import type { AddressInfo } from 'node:net';

const native = vi.hoisted(() => ({
  client: vi.fn(),
  fromId: vi.fn(),
  poll: vi.fn(),
  terminate: vi.fn(),
  readText: vi.fn(),
}));

// Only the public native SDK is replaced; use the real adapter/factory.
vi.mock('modal', () => ({
  SandboxFilesystemNotFoundError: class extends Error {},
  ModalClient: class {
    constructor(config: unknown) { native.client(config); }
    apps = { fromName: async () => ({}) };
    sandboxes = { fromId: native.fromId };
  },
}));

import { modal } from '../index';

const id = 'sb-opaque/id ?#%';
const config = { tokenId: 'mock-id', tokenSecret: 'mock-secret', environment: 'mock-env' };
const failures = [
  ['authentication', Object.assign(new Error('unauthenticated'), { code: 16 })],
  ['permission', Object.assign(new Error('permission denied'), { code: 7 })],
  ['rate limit', Object.assign(new Error('resource exhausted'), { code: 8 })],
  ['network', new TypeError('connection failed')],
  ['misleading message', new Error('upstream 404, not an absence contract')],
  ['misleading name', Object.assign(new Error('denied'), { name: 'NotFoundError' })],
  // modal@0.11.0 poll forwards raw gRPC errors. A numeric gRPC code is
  // not public numeric HTTP status metadata or a native 404 error class.
  ['raw gRPC absence (nullable contract remains blocked)', Object.assign(new Error('missing'), { code: 5 })],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  native.poll.mockResolvedValue(null);
  native.terminate.mockResolvedValue(undefined);
  native.readText.mockResolvedValue('');
  // Installed fromId constructs a handle without an existence query.
  native.fromId.mockResolvedValue({
    sandboxId: id,
    poll: native.poll,
    terminate: native.terminate,
    filesystem: { readText: native.readText },
  });
});

describe('Modal lifecycle contract (public native SDK mocks)', () => {
  it.each([null, 0, 23])('queries native existence before returning an opaque ID (poll=%s)', async status => {
    native.poll.mockResolvedValue(status);
    const instance = await modal(config).instances.getById(id);
    expect(instance?.sandboxId).toBe(id);
    expect(native.fromId).toHaveBeenCalledOnce();
    expect(native.fromId).toHaveBeenCalledWith(id);
    expect(native.poll).toHaveBeenCalledOnce();
    expect(native.poll).toHaveBeenCalledWith();
    expect(native.client).toHaveBeenCalledWith(config);
  });

  it.each(failures)('lookup propagates %s from the actual existence query', async (_kind, error) => {
    native.poll.mockRejectedValue(error);
    await expect(modal(config).instances.getById(id)).rejects.toBe(error);
    expect(native.poll).toHaveBeenCalledOnce();
    expect(native.readText).not.toHaveBeenCalled();
  });

  it.each(failures)('lookup propagates rejected handle acquisition: %s', async (_kind, error) => {
    native.fromId.mockRejectedValue(error);
    await expect(modal(config).instances.getById(id)).rejects.toBe(error);
    expect(native.poll).not.toHaveBeenCalled();
  });

  it('rejects a native handle exposing a different identity', async () => {
    native.fromId.mockResolvedValue({ sandboxId: 'different-id', poll: native.poll });
    await expect(modal(config).instances.getById(id)).rejects.toThrow('identity');
  });

  it.each([
    [null, 'running'],
    [0, 'stopped'],
    [23, 'error'],
    [124, 'error'],
    [137, 'error'],
    [-2147483648, 'error'],
  ] as const)('reports fresh main-Sandbox status and reserved exit metadata (poll=%s)', async (exitCode, status) => {
    const instance = await modal(config).instances.getById(id);
    native.poll.mockClear();
    native.readText.mockClear();
    native.poll.mockResolvedValue(exitCode);
    const info = await instance!.getInfo();
    expect(info).toMatchObject({
      id, provider: 'modal', status,
      metadata: { modalSandboxId: id, realModalImplementation: true, runtime: 'node' },
    });
    if (exitCode === null) expect(info.metadata).not.toHaveProperty('modalExitCode');
    else expect(info.metadata?.modalExitCode).toBe(exitCode);
    expect(native.poll).toHaveBeenCalledOnce();
    expect(native.poll).toHaveBeenCalledWith();
    expect(native.readText).not.toHaveBeenCalled();
    expect(native.terminate).not.toHaveBeenCalled();
  });

  it('does not cache terminal metadata or use a terminate ACK as terminal proof', async () => {
    const provider = modal(config);
    const instance = await provider.instances.getById(id);
    await provider.instances.destroy(id);
    expect((await instance!.getInfo()).metadata).not.toHaveProperty('modalExitCode');
    native.poll.mockResolvedValueOnce(137);
    expect((await instance!.getInfo()).metadata?.modalExitCode).toBe(137);
    expect((await instance!.getInfo()).metadata).not.toHaveProperty('modalExitCode');
    expect(native.poll).toHaveBeenCalledTimes(4);
  });

  it.each(failures)('getInfo propagates %s rather than inventing running or terminal evidence', async (_kind, error) => {
    const instance = await modal(config).instances.getById(id);
    native.poll.mockRejectedValue(error);
    await expect(instance!.getInfo()).rejects.toBe(error);
  });

  it.each([undefined, '137', NaN, Infinity, {}, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid poll result %# without terminal metadata', async result => {
    const instance = await modal(config).instances.getById(id);
    native.poll.mockResolvedValue(result);
    await expect(instance!.getInfo()).rejects.toThrow('invalid exit code');
  });

  it('does not expose a malformed native poll payload in its protocol error', async () => {
    const instance = await modal(config).instances.getById(id);
    native.poll.mockResolvedValue({ privatePayload: 'must-not-leak' });
    const error = await instance!.getInfo().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Modal sandbox poll returned an invalid exit code');
    expect(JSON.stringify(error)).not.toContain('must-not-leak');
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('response');
  });

  it('rechecks canonical identity before polling metadata', async () => {
    const handle = await native.fromId();
    const instance = await modal(config).instances.getById(id);
    native.poll.mockClear();
    handle.sandboxId = 'different-id';
    await expect(instance!.getInfo()).rejects.toThrow('identity');
    expect(native.poll).not.toHaveBeenCalled();
  });

  it('cannot spoof reserved exit metadata using native handle labels', async () => {
    const handle = await native.fromId();
    handle.metadata = { modalExitCode: 137 };
    handle.labels = { modalExitCode: 137 };
    const instance = await modal(config).instances.getById(id);
    expect((await instance!.getInfo()).metadata).not.toHaveProperty('modalExitCode');
    native.poll.mockResolvedValue(0);
    expect((await instance!.getInfo()).metadata?.modalExitCode).toBe(0);
  });

  it('terminates the native handle once, without interpreting a void response', async () => {
    await expect(modal(config).instances.destroy(id)).resolves.toBeUndefined();
    expect(native.fromId).toHaveBeenCalledOnce();
    expect(native.fromId).toHaveBeenCalledWith(id);
    expect(native.terminate).toHaveBeenCalledOnce();
    expect(native.terminate).toHaveBeenCalledWith();
  });

  it.each(failures)('destroy propagates native termination failure: %s', async (_kind, error) => {
    native.terminate.mockRejectedValue(error);
    await expect(modal(config).instances.destroy(id)).rejects.toBe(error);
  });

  it.each(failures)('destroy propagates rejected handle acquisition: %s', async (_kind, error) => {
    native.fromId.mockRejectedValue(error);
    await expect(modal(config).instances.destroy(id)).rejects.toBe(error);
    expect(native.terminate).not.toHaveBeenCalled();
  });
});

describe('Modal installed SDK main-Sandbox poll boundary (HTTP/2 loopback only)', () => {
  it.each([
    [0, 0, null, 'running'],
    [1, 0, 0, 'stopped'],
    [2, 23, 23, 'error'],
    [4, 0, 124, 'error'],
    [3, 0, 137, 'error'],
  ] as const)('maps native result status=%s to fresh SDK metadata', async (nativeStatus, nativeCode, expectedCode, status) => {
    const actual = await vi.importActual<typeof import('modal')>('modal');
    const requests: Array<{ path: string; body: Buffer }> = [];
    const sessions = new Set<ServerHttp2Session>();
    const server = createServer();
    const token = Buffer.from(`e30.${Buffer.from('{"exp":4294967295}').toString('base64url')}.loopback`);
    server.on('session', session => { sessions.add(session); session.on('close', () => sessions.delete(session)); });
    server.on('stream', (stream, headers) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => {
        const path = String(headers[':path']);
        requests.push({ path, body: Buffer.concat(chunks) });
        // Version-pinned wire fixture only; production uses Sandbox.poll().
        // SandboxWaitResponse.result: GenericResult fields status=1, exitcode=3.
        const payload = path.endsWith('/AuthTokenGet') ? Buffer.concat([Buffer.from([10, token.length]), token])
          : Buffer.from([10, 4, 8, nativeStatus, 24, nativeCode]);
        const frame = Buffer.alloc(5 + payload.length);
        frame.writeUInt32BE(payload.length, 1);
        payload.copy(frame, 5);
        stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
        stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
        stream.end(frame);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    // modal@0.11.0 declares endpoint but its constructor does not apply it.
    // The supported server-url environment setting actually confines transport.
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv('MODAL_SERVER_URL', endpoint);
    const client = new actual.ModalClient({
      tokenId: 'loopback-only', tokenSecret: 'loopback-only',
      timeoutMs: 2000, maxRetries: 0,
    });
    try {
      expect(client.profile.serverUrl).toBe(endpoint);
      native.fromId.mockImplementation(async (sandboxId: string) => {
        const handle = await client.sandboxes.fromId(sandboxId);
        // The shared factory reattaches optional egress via a filesystem read.
        // Isolate that unrelated path; native fromId/poll remain unmodified.
        vi.spyOn(handle.filesystem, 'readText').mockResolvedValue('');
        return handle;
      });
      const instance = await modal(config).instances.getById(id);
      const before = requests.length;
      const info = await instance!.getInfo();
      expect(info).toMatchObject({ id, provider: 'modal', status, metadata: { modalSandboxId: id } });
      if (expectedCode === null) expect(info.metadata).not.toHaveProperty('modalExitCode');
      else expect(info.metadata?.modalExitCode).toBe(expectedCode);
      const polls = requests.filter(request => request.path.endsWith('/SandboxWaitV2'));
      expect(polls).toHaveLength(2); // getById existence query, then fresh getInfo
      expect(requests.slice(before)).toHaveLength(1);
      // Exact UTF-8 identity in SandboxWaitRequest.sandbox_id, timeout omitted=0.
      const identity = Buffer.from(id);
      for (const poll of polls) expect(poll.body.subarray(5)).toEqual(Buffer.concat([Buffer.from([10, identity.length]), identity]));
      expect(requests.every(request => /\/(AuthTokenGet|SandboxWaitV2)$/.test(request.path))).toBe(true);
      expect(native.poll).not.toHaveBeenCalled();
      expect(native.terminate).not.toHaveBeenCalled();
    } finally {
      client.close();
      for (const session of sessions) session.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      vi.unstubAllEnvs();
    }
  });
});

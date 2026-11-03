import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ connect: vi.fn(), create: vi.fn(), kill: vi.fn() }));
vi.mock('@hopx-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@hopx-ai/sdk')>('@hopx-ai/sdk');
  return {
    Sandbox: { connect: native.connect, create: native.create },
    APIError: actual.APIError, ErrorCode: actual.ErrorCode,
    AuthenticationError: actual.AuthenticationError, RateLimitError: actual.RateLimitError,
    NetworkError: actual.NetworkError, NotFoundError: actual.NotFoundError,
    FileNotFoundError: actual.FileNotFoundError, SandboxExpiredError: actual.SandboxExpiredError,
    HTTPClient: actual.HTTPClient,
  };
});
import { APIError, ErrorCode, AuthenticationError, RateLimitError, NetworkError, NotFoundError, FileNotFoundError, SandboxExpiredError, HTTPClient } from '@hopx-ai/sdk';
import { hopx } from '../index';

const id = 'opaque-sandbox-id';
const config = { apiKey: ' opaque-api-key ', baseURL: 'https://hopx.invalid/custom' };
const provider = () => hopx(config);
const absent = () => new APIError('native-original-error', ErrorCode.SANDBOX_NOT_FOUND, 'request-id', 404);

// Installed @hopx-ai/sdk 0.5.1 connect calls getInfo (public metadata GET),
// may resume a paused sandbox and refreshes JWT. kill awaits DELETE and returns
// void: there is no completion payload to invent or validate at this boundary.
describe('HopX real-factory lifecycle contract (native SDK boundary)', () => {
  beforeEach(() => {
    for (const key of ['HOPX_API_KEY', 'COMPUTESDK_API_KEY']) vi.stubEnv(key, '');
    native.kill.mockReset().mockResolvedValue(undefined);
    native.connect.mockReset().mockResolvedValue({ sandboxId: id, kill: native.kill });
    native.create.mockReset().mockResolvedValue({ sandboxId: id, kill: native.kill });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('retains native connect and opaque identity/config inputs', async () => {
    const instance = await provider().instances.getById(id);
    expect(instance?.instanceId).toBe(id);
    expect(instance?.getInstance()).toMatchObject({ sandboxId: id });
    expect(native.connect).toHaveBeenCalledOnce();
    expect(native.connect).toHaveBeenCalledWith(id, config.apiKey, config.baseURL);
    expect(native.kill).not.toHaveBeenCalled();
  });

  it('retains API-key environment fallback', async () => {
    vi.stubEnv('HOPX_API_KEY', 'dummy-env-key');
    expect((await hopx({}).instances.getById(id))?.instanceId).toBe(id);
    expect(native.connect).toHaveBeenCalledOnce();
    expect(native.connect).toHaveBeenCalledWith(id, 'dummy-env-key', undefined);
  });

  it('reports absence only for native APIError 404 with SANDBOX_NOT_FOUND code', async () => {
    native.connect.mockRejectedValueOnce(absent());
    await expect(provider().instances.getById(id)).resolves.toBeNull();
  });

  it.each([
    ['Resource unavailable', APIError, true],
    ['sandbox not found', SandboxExpiredError, false],
    ['not found', FileNotFoundError, false],
  ] as const)('uses actual public HTTPClient error mapping for %s without network', async (message, ErrorType, isAbsent) => {
    const client = new HTTPClient({ baseURL: 'https://hopx.invalid', apiKey: 'dummy', maxRetries: 1 });
    let error: unknown;
    try {
      await client.get(`/v1/sandboxes/${id}`, {
        adapter: async () => {
          // Axios adapter rejects entirely in-process. The native HTTPClient's
          // public get/interceptors/handleError path stays real, not fabricated.
          throw Object.assign(new Error(message), {
            isAxiosError: true,
            response: { status: 404, data: { code: ErrorCode.SANDBOX_NOT_FOUND, message }, headers: {} },
          });
        },
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ErrorType);
    native.connect.mockRejectedValueOnce(error);
    if (isAbsent) {
      expect(error).toMatchObject({ statusCode: 404, code: ErrorCode.SANDBOX_NOT_FOUND });
      await expect(provider().instances.getById(id)).resolves.toBeNull();
    } else {
      await expect(provider().instances.getById(id)).rejects.toBe(error);
    }
  });

  const failures = [
    new AuthenticationError('original auth'),
    new RateLimitError('original rate'),
    new NetworkError('original network'),
    new APIError('original server', undefined, undefined, 500),
    new APIError('original unknown 404', undefined, undefined, 404),
    new APIError('wrong-status code', ErrorCode.SANDBOX_NOT_FOUND, undefined, 403),
    new NotFoundError('generic resource'),
    new FileNotFoundError('/unrelated', 'unrelated file'),
    new SandboxExpiredError('expired need not mean metadata absent', { sandboxId: id }),
    new Error('Cannot connect to stopped sandbox'),
    Object.assign(new Error('sandbox not found'), { name: 'NotFoundError', statusCode: 404, code: 'SANDBOX_NOT_FOUND' }),
    { statusCode: 404, code: 'SANDBOX_NOT_FOUND' },
    '404 sandbox not found',
  ];

  it.each(failures)('propagates original nonauthoritative lookup failure %j', async error => {
    native.connect.mockRejectedValueOnce(error);
    await expect(provider().instances.getById(id)).rejects.toBe(error);
  });

  it.each([undefined, null, {}, { sandboxId: '' }, { sandboxId: 'other-sandbox' }])(
    'rejects malformed/wrong lookup identity %j', async handle => {
      native.connect.mockResolvedValueOnce(handle);
      await expect(provider().instances.getById(id)).rejects.toThrow('HopX sandbox lookup returned an invalid identity.');
    },
  );

  it('rejects missing credentials rather than false absence or successful no-op destroy', async () => {
    await expect(hopx({}).instances.getById(id)).rejects.toThrow('Missing HopX API key');
    await expect(hopx({}).instances.destroy(id)).rejects.toThrow('Missing HopX API key');
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.kill).not.toHaveBeenCalled();
  });

  it('awaits native void kill through manager and instance destroy', async () => {
    let complete!: () => void;
    native.kill.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    let finished = false;
    const operation = provider().instances.destroy(id).then(() => { finished = true; });
    await vi.waitFor(() => expect(native.kill).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    complete();
    await operation;
    expect(native.connect).toHaveBeenCalledOnce();
    expect(native.connect).toHaveBeenCalledWith(id, config.apiKey, config.baseURL);
    await (await provider().instances.create()).destroy();
    expect(native.kill).toHaveBeenCalledTimes(2);
  });

  it.each(['connect', 'kill'])('keeps destroy idempotent on authoritative sandbox absence during %s', async stage => {
    native[stage as 'connect' | 'kill'].mockRejectedValueOnce(absent());
    await expect(provider().instances.destroy(id)).resolves.toBeUndefined();
    expect(native.kill).toHaveBeenCalledTimes(stage === 'connect' ? 0 : 1);
  });

  describe.each(['connect', 'kill'] as const)('destroy %s failure', stage => {
    it.each(failures)('propagates original failure %j', async error => {
      native[stage].mockRejectedValueOnce(error);
      await expect(provider().instances.destroy(id)).rejects.toBe(error);
      expect(native.kill).toHaveBeenCalledTimes(stage === 'connect' ? 0 : 1);
    });
  });

  it.each([undefined, null, {}, { sandboxId: 'other-sandbox' }])('never kills invalid lookup handle %j', async handle => {
    native.connect.mockResolvedValueOnce(handle);
    await expect(provider().instances.destroy(id)).rejects.toThrow('HopX sandbox lookup returned an invalid identity.');
    expect(native.kill).not.toHaveBeenCalled();
  });
});

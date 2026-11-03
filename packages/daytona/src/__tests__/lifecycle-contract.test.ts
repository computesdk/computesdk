import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  get: vi.fn(),
  sandboxLookup: vi.fn(),
  toolboxLookup: vi.fn(),
  delete: vi.fn(),
  construct: vi.fn(),
  real: false,
}));

// Exercise the real provider factory. Unit cases isolate public client methods;
// HTTP cases below restore the generated method and instantiate the actual SDK.
// SDK 0.224.0: public get can fail on a SECONDARY toolbox lookup after a
// positive sandbox lookup. Use actual exported error classes, never names or
// locally invented classes. Importing the module does not call a provider API.
vi.mock('@daytonaio/sdk', async () => {
  const actual = await vi.importActual<typeof import('@daytonaio/sdk')>('@daytonaio/sdk');
  return {
    ...actual,
    Daytona: class {
      constructor(options: ConstructorParameters<typeof actual.Daytona>[0]) {
        native.construct(options);
        if (native.real) return new actual.Daytona(options);
      }
      get: typeof actual.Daytona.prototype.get = native.get;
    },
  };
});

import { DaytonaError, DaytonaNotFoundError, Sandbox } from '@daytonaio/sdk';
import { SandboxApi } from '@daytona/api-client';
import axios, { AxiosError } from 'axios';
import { daytona } from '../index';

const provider = () => daytona({ apiKey: 'native-mock-only' });
const metadataLookup = () => vi.mocked(SandboxApi.prototype.getSandbox);

beforeEach(() => {
  vi.clearAllMocks();
  native.real = false;
  native.get.mockReset().mockResolvedValue({ id: 'canonical-id', delete: native.delete });
  native.sandboxLookup.mockReset();
  native.toolboxLookup.mockReset();
  native.delete.mockReset().mockResolvedValue(undefined);
  vi.spyOn(SandboxApi.prototype, 'getSandbox').mockResolvedValue({
    data: { id: 'canonical-id' },
  } as Awaited<ReturnType<SandboxApi['getSandbox']>>);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Daytona native lifecycle contract', () => {
  it.each(['getById', 'destroy'] as const)('%s validates credentials before making any request', async operation => {
    vi.stubEnv('DAYTONA_API_KEY', '');
    await expect(daytona({}).instances[operation]('missing')).rejects.toThrow('Missing Daytona API key');
    expect(metadataLookup()).not.toHaveBeenCalled();
    expect(native.construct).not.toHaveBeenCalled();
  });

  it.each([
    new DaytonaNotFoundError('opaque native 404', 404),
    new DaytonaError('opaque HTTP 404', 404),
    Object.assign(new Error('opaque'), { response: { status: 404 } }),
    Object.assign(new Error('opaque'), { statusCode: 404 }),
    Object.assign(new Error('opaque'), { status: 404 }),
    Object.assign(new Error('opaque'), { response: { status: '404' } }),
    Object.assign(new AxiosError('opaque'), { response: { status: '404' } }),
    Object.assign(new AxiosError('opaque'), { status: 404 }),
    new Error('404 not found'),
    new AxiosError('connection failed', 'ECONNRESET'),
  ])('does not infer metadata absence from untyped errors or missing HTTP responses %#', async error => {
    metadataLookup().mockRejectedValueOnce(error);
    await expect(provider().instances.getById('missing')).rejects.toMatchObject({
      name: 'DaytonaMetadataLookupError',
      message: 'Daytona sandbox metadata lookup failed.',
      statusCode: undefined,
    });
    expect(native.construct).not.toHaveBeenCalled();
    expect(native.get).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { id: '' }, { id: 7 }, { code: 404, message: 'not found' }])(
    'rejects malformed successful resource metadata before hydrating %#',
    async data => {
      metadataLookup().mockResolvedValueOnce({ data } as Awaited<ReturnType<SandboxApi['getSandbox']>>);
      await expect(provider().instances.getById('existing')).rejects.toThrow();
      expect(native.construct).not.toHaveBeenCalled();
      expect(native.get).not.toHaveBeenCalled();
    },
  );

  it('rejects a full native handle whose identity differs from the resource metadata', async () => {
    native.get.mockResolvedValueOnce({ id: 'different-id', delete: native.delete });
    await expect(provider().instances.getById('lookup-name')).rejects.toThrow('inconsistent native identity');
    expect(native.get).toHaveBeenCalledWith('canonical-id');
  });

  it('queries existence and returns the native identity rather than a lookup alias', async () => {
    const sandbox = await provider().instances.getById('lookup-name');
    expect(metadataLookup()).toHaveBeenCalledWith('lookup-name');
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith('canonical-id');
    expect(sandbox?.instanceId).toBe('canonical-id');
    expect(sandbox?.getInstance()).toMatchObject({ id: 'canonical-id' });
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([
    new DaytonaNotFoundError('opaque native 404', 404),
    new DaytonaError('opaque HTTP 404', 404),
  ])('propagates ambiguous public-get 404s rather than inventing absence %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById('missing')).rejects.toBe(error);
  });

  it.each(['getById', 'destroy'] as const)(
    '%s propagates the actual native 404 from a secondary lookup after sandbox existence was proven',
    async operation => {
      const error = new DaytonaNotFoundError('auxiliary resource unavailable', 404);
      const sandbox = { id: 'canonical-id', delete: native.delete };
      native.sandboxLookup.mockResolvedValueOnce(sandbox);
      native.toolboxLookup.mockRejectedValueOnce(error);
      // Model the documented public get sequence (Daytona.js:460-463,
      // 528-536), not private SDK entry points or an invented endpoint API.
      native.get.mockImplementationOnce(async (id: string) => {
        const existing = await native.sandboxLookup(id);
        await native.toolboxLookup(existing.id);
        return existing;
      });
      await expect(provider().instances[operation]('lookup-name')).rejects.toBe(error);
      expect(native.sandboxLookup).toHaveBeenCalledWith('canonical-id');
      expect(native.toolboxLookup).toHaveBeenCalledWith('canonical-id');
      expect(native.sandboxLookup.mock.invocationCallOrder[0])
        .toBeLessThan(native.toolboxLookup.mock.invocationCallOrder[0]);
      expect(native.delete).not.toHaveBeenCalled();
    },
  );

  it.each([
    new Error('sandbox not found in proxy configuration'),
    new Error('request token 404 rejected'),
    Object.assign(new Error('not found'), { statusCode: 401 }),
    Object.assign(new Error('not found'), { statusCode: 403 }),
    Object.assign(new Error('404'), { statusCode: 429 }),
    Object.assign(new Error('not found'), { statusCode: 503 }),
    Object.assign(new Error('opaque'), { statusCode: '404' }),
    Object.assign(new Error('opaque'), { status: 404 }),
    Object.assign(new Error('opaque'), { name: 'DaytonaNotFoundError' }),
    new Error('ECONNRESET'),
  ])('preserves non-absence lookup errors %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById('existing')).rejects.toBe(error);
  });

  it.each([undefined, null, {}, { id: '' }, { id: 7 }])(
    'rejects a malformed successful native lookup %# without inventing an instance',
    async result => {
      native.get.mockResolvedValueOnce(result);
      await expect(provider().instances.getById('existing')).rejects.toThrow();
    },
  );

  it('accepts native void deletion, awaiting it exactly once', async () => {
    await expect(provider().instances.destroy('existing')).resolves.toBeUndefined();
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith('canonical-id');
    expect(native.delete).toHaveBeenCalledOnce();
    expect(native.delete).toHaveBeenCalledWith();
  });

  it.each([
    new DaytonaNotFoundError('opaque native 404', 404),
    new DaytonaError('opaque HTTP 404', 404),
  ])('does not silently no-op destroy for ambiguous public-get 404s %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy('missing')).rejects.toBe(error);
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([
    new Error('not found in proxy configuration'),
    Object.assign(new Error('request 404 failed'), { statusCode: 503 }),
    new Error('ECONNRESET'),
  ])('preserves destroy lookup errors %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([
    new Error('request 404 failed'),
    Object.assign(new Error('not found'), { statusCode: 503 }),
    new DaytonaNotFoundError('deletion raced'),
    new Error('ECONNRESET'),
  ])('does not suppress native deletion errors after a positive lookup %#', async error => {
    native.delete.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
    expect(native.delete).toHaveBeenCalledOnce();
  });
});

describe('Daytona actual HTTP lifecycle boundary (loopback only)', () => {
  type Reply = { status: number; body?: unknown; location?: string; disconnect?: boolean };
  async function withHTTP(
    reply: (request: string, index: number, apiUrl: string) => Reply,
    run: (apiUrl: string, requests: string[], authorization: (string | undefined)[]) => Promise<void>,
  ) {
    const requests: string[] = [];
    const authorization: (string | undefined)[] = [];
    let apiUrl: string;
    const server = createServer((req, res) => {
      const request = `${req.method} ${req.url}`;
      requests.push(request);
      authorization.push(req.headers.authorization);
      const result = reply(request, requests.length - 1, apiUrl);
      if (result.disconnect) {
        req.socket.destroy();
        return;
      }
      res.writeHead(result.status, {
        'content-type': 'application/json',
        ...(result.location && { location: result.location }),
      });
      res.end(result.body === undefined ? undefined : JSON.stringify(result.body));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    // Both the unpatched and patched adapter are confined to loopback.
    vi.stubEnv('DAYTONA_API_URL', apiUrl);
    vi.stubEnv('DAYTONA_API_KEY', 'loopback-env-only');
    vi.stubEnv('DAYTONA_USE_DEPRECATED_POLLING', 'true');
    metadataLookup().mockRestore();
    native.real = true;
    try {
      await run(apiUrl, requests, authorization);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  const loopbackProvider = (apiUrl: string) => daytona({
    apiKey: 'loopback-only',
    apiUrl,
    organizationId: 'caller-organization',
    target: 'caller-target',
  });
  const dto = (apiUrl: string) => ({
    id: 'canonical-id',
    name: 'lookup-name',
    state: 'started',
    labels: {},
    toolboxProxyUrl: `${apiUrl}/toolbox`,
  });
  const invalidIdentities = [
    '', '.', '..', ' leading', 'trailing ', '\tname', 'name\n', 'name\u0000',
    'name\u001f', 'name\u007f', 'a/b', 'a\\b', 'a?b', 'a#b', '%2e%2e',
    '%252e%252e', 'a%2fb', 'https://wrong.example/name', 'https:wrong',
    '\u00a0name', 'name\u00a0', '\ud800',
  ];
  function assertSafeMetadataFailure(failure: unknown, secret: string, statusCode?: number) {
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      name: 'DaytonaMetadataLookupError',
      message: 'Daytona sandbox metadata lookup failed.',
      code: 'DAYTONA_METADATA_LOOKUP_FAILED',
      statusCode,
    });
    expect(inspect(failure, { depth: 12, showHidden: true })).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
    for (const field of ['cause', 'config', 'request', 'response']) {
      expect(failure).not.toHaveProperty(field);
    }
  }

  describe.each(['getById', 'destroy'] as const)('%s unambiguous opaque identity boundary', operation => {
    it.each(invalidIdentities)('rejects caller identity %# with zero native HTTP requests', async identity => {
      await withHTTP(() => ({ status: 404 }), async (apiUrl, requests) => {
        await expect(loopbackProvider(apiUrl).instances[operation](identity)).rejects.toThrow(
          'unambiguous native ID or name',
        );
        expect(requests).toEqual([]);
        expect(native.construct).not.toHaveBeenCalled();
      });
    });

    it.each(invalidIdentities)('rejects canonical metadata identity %# before native full-get or DELETE', async identity => {
      await withHTTP((_request, _index, apiUrl) => ({
        status: 200, body: { ...dto(apiUrl), id: identity },
      }), async (apiUrl, requests) => {
        await expect(loopbackProvider(apiUrl).instances[operation]('lookup-name')).rejects.toThrow();
        expect(requests).toEqual(['GET /api/sandbox/lookup-name']);
        expect(native.construct).not.toHaveBeenCalled();
      });
    });
  });

  it('rejects a caller dot segment before any native HTTP request', async () => {
    await withHTTP(() => ({ status: 404 }), async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.destroy('..')).rejects.toThrow();
      expect(requests).toEqual([]);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it('rejects a canonical metadata dot segment before native full-get or DELETE', async () => {
    await withHTTP((_request, index, apiUrl) => index === 0
      ? { status: 200, body: { ...dto(apiUrl), id: '..' } }
      : { status: 404 }, async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.destroy('lookup-name')).rejects.toThrow();
      expect(requests).toEqual(['GET /api/sandbox/lookup-name']);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it('does not expose metadata request credentials through errors, serialization, inspection, or cause', async () => {
    const secret = 'metadata-secret-sentinel-do-not-expose';
    await withHTTP(() => ({ status: 401, body: { message: secret } }), async apiUrl => {
      const failure = await daytona({ apiKey: secret, apiUrl }).instances.getById('lookup-name').catch(error => error);
      assertSafeMetadataFailure(failure, secret, 401);
    });
  });

  it.each([401, 403, 429, 500, 503])('redacts all metadata HTTP%i error details, retaining only safe numeric status', async status => {
    const secret = 'metadata-secret-sentinel-do-not-expose';
    await withHTTP(() => ({ status, body: { message: secret, config: { bearer: secret } } }), async apiUrl => {
      for (const operation of ['getById', 'destroy'] as const) {
        const failure = await daytona({ apiKey: secret, apiUrl }).instances[operation]('lookup-name').catch(error => error);
        assertSafeMetadataFailure(failure, secret, status);
      }
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it.each(['getById', 'destroy'] as const)('%s redacts actual metadata connection failures without retaining a raw cause', async operation => {
    const secret = 'metadata-secret-sentinel-do-not-expose';
    await withHTTP(() => ({ status: 0, disconnect: true }), async (apiUrl, requests) => {
      const failure = await daytona({ apiKey: secret, apiUrl }).instances[operation]('lookup-name').catch(error => error);
      assertSafeMetadataFailure(failure, secret);
      expect(requests).toEqual(['GET /api/sandbox/lookup-name']);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it('returns null only for the initial resource GET HTTP 404, without constructing Daytona or hydrating', async () => {
    await withHTTP(() => ({ status: 404 }), async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.getById('missing-name')).resolves.toBeNull();
      expect(requests).toEqual(['GET /api/sandbox/missing-name']);
      expect(native.construct).not.toHaveBeenCalled();
      expect(native.get).not.toHaveBeenCalled();
    });
  });

  it('uses the existing process API-key/endpoint fallback without a high-level constructor', async () => {
    await withHTTP(() => ({ status: 404 }), async (_apiUrl, requests, authorization) => {
      await expect(daytona({}).instances.getById('missing')).resolves.toBeNull();
      expect(requests).toEqual(['GET /api/sandbox/missing']);
      expect(authorization).toEqual(['Bearer loopback-env-only']);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it('isolates the metadata transport from application global axios interceptors', async () => {
    const interceptor = axios.interceptors.request.use(() => {
      throw new Error('Application global interceptor must not run');
    });
    try {
      await withHTTP(() => ({ status: 404 }), async (apiUrl, requests) => {
        await expect(loopbackProvider(apiUrl).instances.getById('missing')).resolves.toBeNull();
        expect(requests).toEqual(['GET /api/sandbox/missing']);
      });
    } finally {
      axios.interceptors.request.eject(interceptor);
    }
  });

  it('no-ops destroy only on initial resource GET HTTP 404 without DELETE or hydration', async () => {
    await withHTTP(() => ({ status: 404 }), async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.destroy('missing-name')).resolves.toBeUndefined();
      expect(requests).toEqual(['GET /api/sandbox/missing-name']);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it.each([401, 403, 429, 503])('propagates real initial resource HTTP %i, never treating it as absence', async status => {
    await withHTTP(() => ({ status, body: { message: '404 not found', code: 404 } }), async (apiUrl, requests) => {
      for (const operation of ['getById', 'destroy'] as const) {
        await expect(loopbackProvider(apiUrl).instances[operation]('existing')).rejects.toMatchObject({
          name: 'DaytonaMetadataLookupError',
          statusCode: status,
        });
      }
      expect(requests).toEqual(['GET /api/sandbox/existing', 'GET /api/sandbox/existing']);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });

  it.each(['getById', 'destroy'] as const)('%s propagates actual toolbox HTTP 404 after positive resource metadata', async operation => {
    await withHTTP((request, _index, apiUrl) => {
      if (request === 'GET /api/sandbox/canonical-id/toolbox-proxy-url') {
        return { status: 404, body: { source: 'proxy', message: 'auxiliary resource unavailable' } };
      }
      const { toolboxProxyUrl: _toolbox, ...metadata } = dto(apiUrl);
      return { status: 200, body: metadata };
    }, async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances[operation]('lookup-name')).rejects.toBeInstanceOf(DaytonaNotFoundError);
      expect(requests).toEqual([
        'GET /api/sandbox/lookup-name',
        'GET /api/sandbox/canonical-id',
        'GET /api/sandbox/canonical-id/toolbox-proxy-url',
      ]);
      expect(native.construct).toHaveBeenCalledOnce();
    });
  });

  it.each(['getById', 'destroy'] as const)('%s propagates a raced resource HTTP 404 during public full get', async operation => {
    await withHTTP((_request, index, apiUrl) => index === 0
      ? { status: 200, body: dto(apiUrl) }
      : { status: 404 }, async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances[operation]('lookup-name')).rejects.toBeInstanceOf(DaytonaNotFoundError);
      expect(requests).toEqual(['GET /api/sandbox/lookup-name', 'GET /api/sandbox/canonical-id']);
    });
  });

  it('hydrates a genuine full native handle using the exact canonical resource id', async () => {
    await withHTTP((request, _index, apiUrl) => request.startsWith('GET /api/sandbox/')
      ? { status: 200, body: dto(apiUrl) }
      : { status: 404 }, async (apiUrl, requests, authorization) => {
      vi.stubEnv('DAYTONA_API_URL', `${apiUrl}/environment-other-scope`);
      vi.stubEnv('DAYTONA_ORGANIZATION_ID', 'environment-organization');
      vi.stubEnv('DAYTONA_TARGET', 'environment-target');
      const instance = await loopbackProvider(apiUrl).instances.getById('lookup-name');
      expect(instance?.instanceId).toBe('canonical-id');
      expect(instance?.getInstance()).toBeInstanceOf(Sandbox);
      // Factory reattachment may also read the optional egress pointer through
      // the real toolbox filesystem. The resource and hydration calls are first.
      expect(requests.slice(0, 2)).toEqual(['GET /api/sandbox/lookup-name', 'GET /api/sandbox/canonical-id']);
      expect(authorization.slice(0, 2)).toEqual(['Bearer loopback-only', 'Bearer loopback-only']);
      expect(native.construct).toHaveBeenCalledWith({
        apiKey: 'loopback-only', apiUrl, organizationId: 'caller-organization', target: 'caller-target',
      });
    });
  });

  it('accepts a real void DELETE acknowledgement using the canonical identity', async () => {
    await withHTTP((request, _index, apiUrl) => request === 'DELETE /api/sandbox/canonical-id'
      ? { status: 204 }
      : { status: 200, body: dto(apiUrl) }, async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.destroy('lookup-name')).resolves.toBeUndefined();
      expect(requests).toEqual([
        'GET /api/sandbox/lookup-name', 'GET /api/sandbox/canonical-id', 'DELETE /api/sandbox/canonical-id',
      ]);
    });
  });

  it('does not suppress a real DELETE HTTP 404 after positive resource metadata and hydration', async () => {
    await withHTTP((request, _index, apiUrl) => request === 'DELETE /api/sandbox/canonical-id'
      ? { status: 404 }
      : { status: 200, body: dto(apiUrl) }, async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.destroy('lookup-name')).rejects.toBeInstanceOf(DaytonaNotFoundError);
      expect(requests).toEqual([
        'GET /api/sandbox/lookup-name', 'GET /api/sandbox/canonical-id', 'DELETE /api/sandbox/canonical-id',
      ]);
    });
  });

  it('does not follow an initial metadata redirect or infer absence from the redirected resource', async () => {
    await withHTTP((_request, _index, apiUrl) => ({
      status: 302, location: `${apiUrl}/redirect-target`,
    }), async (apiUrl, requests) => {
      await expect(loopbackProvider(apiUrl).instances.getById('lookup-name')).rejects.toMatchObject({
        name: 'DaytonaMetadataLookupError', statusCode: 302,
      });
      expect(requests).toEqual(['GET /api/sandbox/lookup-name']);
      expect(native.construct).not.toHaveBeenCalled();
    });
  });
});

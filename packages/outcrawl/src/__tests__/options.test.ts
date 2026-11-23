import { afterEach, describe, expect, it, vi } from 'vitest';
import { outcrawl } from '../index';

const oc = outcrawl({ apiKey: 'test-key' });

const allocation = {
  sessionId: 'ses_123',
  wsEndpoint: 'wss://api.outcrawl.ai/cdp/ticket-abc',
  expiresAt: '2099-01-01T00:00:00Z',
};

function mockFetch(handler: (url: URL, init?: RequestInit) => Response) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(input.toString());
      calls.push(url);
      return handler(url, init);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outcrawl create', () => {
  it('calls /connect with the key and returns the CDP endpoint', async () => {
    const calls = mockFetch(() => json(allocation));
    const session = await oc.session.create();
    expect(calls[0].origin + calls[0].pathname).toBe('https://api.outcrawl.ai/connect');
    expect(calls[0].searchParams.get('token')).toBe('test-key');
    expect(session.sessionId).toBe('ses_123');
    expect(session.connectUrl).toBe(allocation.wsEndpoint);
  });

  it('maps profileId and recording=false', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create({ profileId: 'prof_1', recording: false });
    expect(calls[0].searchParams.get('profile')).toBe('prof_1');
    expect(calls[0].searchParams.get('record')).toBe('false');
  });

  it('maps a custom proxy to a proxy URL with credentials', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create({
      proxies: [{ type: 'custom', server: 'http://proxy.example.com:8080', username: 'u', password: 'p' }],
    });
    expect(calls[0].searchParams.get('proxy')).toBe('http://u:p@proxy.example.com:8080/');
  });

  it('maps proxy geolocation to the exit params', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create({
      proxies: [{ type: 'residential', geolocation: { country: 'us', state: 'texas', city: 'austin' } }],
    });
    expect(calls[0].searchParams.get('proxy_country')).toBe('us');
    expect(calls[0].searchParams.get('proxy_region')).toBe('texas');
    expect(calls[0].searchParams.get('proxy_city')).toBe('austin');
  });

  it('sends no proxy param for proxies=true', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create({ proxies: true });
    expect([...calls[0].searchParams.keys()]).toEqual(['token']);
  });

  it('keeps the API key out of the error message', async () => {
    mockFetch(() => new Response('bad key test-key', { status: 401 }));
    await expect(oc.session.create()).rejects.toThrow(/401: bad key \*\*\*/);
  });

  it('rejects an answer without a ws endpoint', async () => {
    mockFetch(() => json({ sessionId: 'ses_123' }));
    await expect(oc.session.create()).rejects.toThrow(/without a sessionId and wsEndpoint/);
  });

  it('fails clearly without an API key', async () => {
    const saved = process.env.OUTCRAWL_API_KEY;
    delete process.env.OUTCRAWL_API_KEY;
    await expect(outcrawl({}).session.create()).rejects.toThrow(/Missing Outcrawl API key/);
    if (saved !== undefined) process.env.OUTCRAWL_API_KEY = saved;
  });
});

describe('outcrawl keepAlive', () => {
  it('maps keepAlive to idle_timeout, using timeout seconds clamped to 10..21600', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create({ keepAlive: true });
    await oc.session.create({ keepAlive: true, timeout: 5 });
    await oc.session.create({ keepAlive: true, timeout: 90000 });
    expect(calls.map((c) => c.searchParams.get('idle_timeout'))).toEqual(['300', '10', '21600']);
  });

  it('sends no idle_timeout without keepAlive', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create({ timeout: 600 });
    expect(calls[0].searchParams.has('idle_timeout')).toBe(false);
  });

  it('getConnectUrl re-attaches with session=<id> for a session this process did not create', async () => {
    const calls = mockFetch(() => json({ ...allocation, wsEndpoint: 'wss://api.outcrawl.ai/cdp/fresh' }));
    expect(await oc.getConnectUrl('ses_other')).toBe('wss://api.outcrawl.ai/cdp/fresh');
    expect(calls[0].searchParams.get('session')).toBe('ses_other');
  });

  it('getConnectUrl returns the unexpired ticket of a session create() just allocated, without a call', async () => {
    const calls = mockFetch(() => json(allocation));
    await oc.session.create();
    expect(await oc.getConnectUrl('ses_123')).toBe(allocation.wsEndpoint);
    expect(calls).toHaveLength(1);
  });

  it('never returns one client\'s ticket to another API key or base URL', async () => {
    const calls = mockFetch((url) =>
      json(url.searchParams.has('session') ? { ...allocation, wsEndpoint: 'wss://other/cdp/fresh' } : allocation),
    );
    await oc.session.create();
    const otherKey = outcrawl({ apiKey: 'other-key' });
    const otherHost = outcrawl({ apiKey: 'test-key', baseUrl: 'https://eu.outcrawl.example' });
    expect(await otherKey.getConnectUrl('ses_123')).toBe('wss://other/cdp/fresh');
    expect(await otherHost.getConnectUrl('ses_123')).toBe('wss://other/cdp/fresh');
    expect(calls.filter((c) => c.searchParams.has('session'))).toHaveLength(2);
  });

  it('forgets the issued ticket on destroy', async () => {
    const calls = mockFetch((url, init) =>
      init?.method === 'DELETE' ? json({ id: 'ses_123' }) : json(url.searchParams.has('session') ? { ...allocation, wsEndpoint: 'wss://after/destroy' } : allocation),
    );
    await oc.session.create();
    await oc.session.destroy('ses_123');
    expect(await oc.getConnectUrl('ses_123')).toBe('wss://after/destroy');
    expect(calls.at(-1)?.searchParams.get('session')).toBe('ses_123');
  });

  it('getConnectUrl re-attaches once the issued ticket has expired', async () => {
    const calls = mockFetch((url) =>
      json(url.searchParams.has('session')
        ? { ...allocation, wsEndpoint: 'wss://api.outcrawl.ai/cdp/fresh' }
        : { ...allocation, sessionId: 'ses_old', expiresAt: '2000-01-01T00:00:00Z' }),
    );
    await oc.session.create();
    expect(await oc.getConnectUrl('ses_old')).toBe('wss://api.outcrawl.ai/cdp/fresh');
    expect(calls).toHaveLength(2);
  });
});

describe('outcrawl session reads', () => {
  it('getById returns null for a 404', async () => {
    mockFetch(() => json({ code: 'not_found' }, 404));
    expect(await oc.session.getById('nope')).toBeNull();
  });

  it('getById reads the session and gives no live endpoint', async () => {
    const calls = mockFetch(() => json({ data: { id: 'ses_123', status: 'running' } }));
    const session = await oc.session.getById('ses_123');
    expect(session?.status).toBe('running');
    expect(session?.connectUrl).toBe('');
    expect(calls).toHaveLength(1);
  });

  it('list maps the data array', async () => {
    mockFetch(() => json({ data: [{ id: 'a', status: 'running' }, { id: 'b', status: 'failed' }] }));
    const sessions = await oc.session.list();
    expect(sessions.map((s) => [s.sessionId, s.status])).toEqual([
      ['a', 'running'],
      ['b', 'failed'],
    ]);
  });
});

describe('outcrawl destroy', () => {
  it('ends the session with an authenticated DELETE', async () => {
    let seen: { url: URL; init?: RequestInit } | undefined;
    mockFetch((url, init) => {
      seen = { url, init };
      return json({ id: 'ses_123' });
    });
    await oc.session.destroy('ses_123');
    expect(seen?.url.pathname).toBe('/v1/sessions/ses_123');
    expect(seen?.init?.method).toBe('DELETE');
    expect((seen?.init?.headers as Record<string, string>).authorization).toBe('Bearer test-key');
  });

  it('is a no-op when the session is gone', async () => {
    mockFetch(() => json({ code: 'not_found' }, 404));
    await expect(oc.session.destroy('ses_gone')).resolves.toBeUndefined();
  });

  it('throws on other errors without leaking the key', async () => {
    mockFetch(() => new Response('denied test-key', { status: 403 }));
    await expect(oc.session.destroy('ses_1')).rejects.toThrow(/destroy 403: denied \*\*\*/);
  });
});

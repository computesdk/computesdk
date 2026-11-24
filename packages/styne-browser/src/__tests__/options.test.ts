import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyneApiError, styneBrowser } from '../index';

const KEY = 'sk_test_key';
const sb = styneBrowser({ apiKey: KEY });

const session = (id = 'br_1', state = 'running') => ({
  id,
  state,
  cdp_url: `wss://${id}.ash.styne.ai/devtools/browser?token=t-${state}`,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

function mockFetch(...responses: Response[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({
        method: init.method!,
        path: url.pathname,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return responses.shift() ?? json(session());
    }),
  );
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('styne-browser create', () => {
  it('creates a session and returns its cdp_url as connectUrl', async () => {
    const calls = mockFetch(json(session(), 201));
    const created = await sb.session.create();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/browsers', body: {} });
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(created.sessionId).toBe('br_1');
    expect(created.connectUrl).toBe(session().cdp_url);
  });

  it('maps session options onto the create body', async () => {
    const calls = mockFetch();
    await sb.session.create({
      timeout: 299.5,
      region: 'ash',
      profileId: 'prof_1',
      keepAlive: true,
      stealth: true,
      recording: false,
      viewport: { width: 1920, height: 1080 },
      userMetadata: { run: 'r1' },
      saveDownloads: true,
      proxies: [{ type: 'datacenter', geolocation: { country: 'DE' } }],
    });
    expect(calls[0].body).toEqual({
      timeout: 300,
      region: 'ash',
      profile: 'prof_1',
      persist: true,
      metadata: { run: 'r1' },
      downloads: true,
      idle_timeout_seconds: 0,
      captcha: 'solve',
      recording: false,
      viewport: { width: 1920, height: 1080 },
      egress: 'mullvad',
      country: 'de',
    });
  });

  it('refuses a timeout that is not a positive number', async () => {
    const calls = mockFetch();
    await expect(sb.session.create({ timeout: 0 })).rejects.toThrow('positive number');
    await expect(sb.session.create({ timeout: Number.NaN })).rejects.toThrow('positive number');
    expect(calls).toHaveLength(0);
  });

  it('maps stealth: false to unblock and captcha off, proxies: true to residential', async () => {
    const calls = mockFetch();
    await sb.session.create({ stealth: false, proxies: true });
    expect(calls[0].body).toEqual({ unblock: 'off', captcha: 'off', egress: 'residential' });
  });

  it('warns once for options without a Styne equivalent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch();
    const options = { keepAlive: false, extensionIds: ['ext'] };
    await sb.session.create(options);
    await sb.session.create(options);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("'keepAlive' is ignored");
  });

  it('retries a create under the same Idempotency-Key after a 503 and a 409 conflict', async () => {
    const calls = mockFetch(
      json({ code: 503, error_code: 'upstream_error', message: 'busy' }, 503),
      json({ code: 409, error_code: 'conflict', message: 'request in flight' }, 409),
      json(session(), 201),
    );
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const pending = sb.session.create();
    await vi.runAllTimersAsync();
    expect((await pending).sessionId).toBe('br_1');
    expect(calls).toHaveLength(3);
    const keys = new Set(calls.map((c) => c.headers['idempotency-key']));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retries a 2xx whose body cannot be read', async () => {
    const calls = mockFetch(new Response('{"id": "br_1", "cdp', { status: 201 }), json(session(), 201));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const pending = sb.session.create();
    await vi.runAllTimersAsync();
    expect((await pending).sessionId).toBe('br_1');
    expect(calls).toHaveLength(2);
  });

  it('does not retry quota refusals', async () => {
    const calls = mockFetch(json({ code: 429, error_code: 'resident_limit', message: 'limit' }, 429));
    const error = await sb.session.create().catch((e) => e);
    expect(error).toBeInstanceOf(StyneApiError);
    expect(error.code).toBe('resident_limit');
    expect(calls).toHaveLength(1);
  });

  it('names the Idempotency-Key when the create outcome is unknown', async () => {
    const calls = mockFetch(...Array.from({ length: 5 }, () => json({ error_code: 'upstream_error' }, 502)));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const pending = sb.session.create().catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(calls).toHaveLength(5);
    expect(error.idempotencyKey).toBe(calls[0].headers['idempotency-key']);
    expect(error.message).toContain(error.idempotencyKey);
  });

  it('deletes a session created without a cdp_url and names it in the error', async () => {
    const calls = mockFetch(json({ id: 'br_9', state: 'running' }, 201), new Response(null, { status: 204 }));
    const error = await sb.session.create().catch((e) => e);
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/browsers/br_9' });
    expect(error.message).toContain('session br_9 deleted');
  });

  it('refuses a plain-http API URL except on localhost', async () => {
    mockFetch();
    await expect(styneBrowser({ apiKey: KEY, apiUrl: 'http://api.example.com' }).session.create()).rejects.toThrow(
      'must use https',
    );
    await expect(styneBrowser({ apiKey: KEY, apiUrl: 'http://localhost:8080' }).session.create()).resolves.toBeTruthy();
  });

  it('masks the API key in errors', async () => {
    mockFetch(json({ code: 422, error_code: 'invalid', message: `bad key ${KEY}` }, 422));
    const error = await sb.session.create().catch((e) => e);
    expect(error).toBeInstanceOf(StyneApiError);
    expect(error.message).toContain('***');
    expect(error.message).not.toContain(KEY);
  });
});

describe('styne-browser session reads', () => {
  it('returns null only for a not_found 404', async () => {
    mockFetch(json({ code: 404, error_code: 'not_found', message: 'no such browser' }, 404));
    expect(await sb.session.getById('br_x')).toBeNull();

    mockFetch(json({ message: 'Not Found' }, 404));
    await expect(sb.session.getById('br_x')).rejects.toBeInstanceOf(StyneApiError);
  });

  it('resumes a paused session before returning its connect URL', async () => {
    const calls = mockFetch(json(session('br_1', 'paused')), json({}, 201), json(session()));
    expect(await sb.getConnectUrl('br_1')).toBe(session().cdp_url);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /browsers/br_1',
      'POST /sandboxes/br_1/resume',
      'GET /browsers/br_1',
    ]);
  });

  it('maps session states and rejects a connect URL for an ended session', async () => {
    mockFetch(json({ sessions: [session('a', 'running'), session('b', 'expired'), session('c', 'stopped')] }));
    const entries = await sb.session.list();
    expect(entries.map((e) => [e.status, e.connectUrl !== undefined])).toEqual([
      ['running', true],
      ['timed_out', false],
      ['completed', false],
    ]);
    mockFetch(json(session('b', 'expired')));
    await expect(sb.getConnectUrl('b')).rejects.toThrow('is expired');
  });

  it('saves a profile session back into its profile on destroy', async () => {
    const calls = mockFetch(json(session('br_p'), 201), json({ id: 'prof_1' }), new Response(null, { status: 204 }));
    await sb.session.create({ profileId: 'prof_1' });
    await sb.session.destroy('br_p');
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/profiles/prof_1/save', body: { browser_id: 'br_p' } });
    expect(calls[2]).toMatchObject({ method: 'DELETE', path: '/browsers/br_p' });
  });
});

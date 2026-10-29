import { describe, expect, it } from 'vitest';
import { browserless } from '../index';

const bl = browserless({ apiKey: 'test-token' });

async function connectParams(options?: Parameters<typeof bl.session.create>[0]) {
  const session = await bl.session.create(options);
  return new URL(session.connectUrl!);
}

describe('browserless connect URL', () => {
  it('builds a wss chromium URL with token and trackingId', async () => {
    const url = await connectParams();
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('production-sfo.browserless.io');
    expect(url.pathname).toBe('/chromium');
    expect(url.searchParams.get('token')).toBe('test-token');
    expect(url.searchParams.get('trackingId')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the trackingId as the sessionId', async () => {
    const session = await bl.session.create();
    const url = new URL(session.connectUrl!);
    expect(url.searchParams.get('trackingId')).toBe(session.sessionId);
  });

  it('maps stealth onto the stealth param', async () => {
    const url = await connectParams({ stealth: true });
    expect(url.searchParams.get('stealth')).toBe('true');
  });

  it('maps viewport onto the launch JSON', async () => {
    const url = await connectParams({ viewport: { width: 1920, height: 1080 } });
    expect(JSON.parse(url.searchParams.get('launch')!)).toEqual({
      defaultViewport: { width: 1920, height: 1080 },
    });
  });

  it('maps proxies=true to residential', async () => {
    const url = await connectParams({ proxies: true });
    expect(url.searchParams.get('proxy')).toBe('residential');
  });

  it('honors baseUrl config and BROWSERLESS_URL env', async () => {
    const custom = browserless({ apiKey: 't', baseUrl: 'https://chrome-us-east.browserless.io' });
    const session = await custom.session.create();
    expect(new URL(session.connectUrl!).host).toBe('chrome-us-east.browserless.io');

    process.env.BROWSERLESS_URL = 'https://production-ams.browserless.io';
    try {
      const fromEnv = browserless({ apiKey: 't' });
      const s2 = await fromEnv.session.create();
      expect(new URL(s2.connectUrl!).host).toBe('production-ams.browserless.io');
    } finally {
      delete process.env.BROWSERLESS_URL;
    }
  });

  it('throws a helpful error without an API key', () => {
    const saved = process.env.BROWSERLESS_API_KEY;
    delete process.env.BROWSERLESS_API_KEY;
    try {
      expect(() => browserless({}).session.create()).rejects.toThrow('BROWSERLESS_API_KEY');
    } finally {
      if (saved) process.env.BROWSERLESS_API_KEY = saved;
    }
  });
});

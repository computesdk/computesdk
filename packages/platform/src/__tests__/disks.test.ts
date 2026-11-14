import { describe, it, expect } from 'vitest';
import { PlatformClient } from '../client.js';
describe('platform retained disk lifecycle client', () => {
  it('preserves idempotency and canonical storage placement in create, get and delete', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const disk = { id: '11111111-1111-4111-8111-111111111111', region: 'aws-us-east-1', regionSource: 'explicit', state: 'ready', attachment: null, createdAt: '2026-11-14T00:00:00Z' };
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ disk }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const c = new PlatformClient({ baseUrl: 'https://platform.computesdk.com', apiKey: 'test' }, fetcher);
    const input = { idempotencyKey: 'one', provider: 'namespace', region: 'aws-us-east-1' };
    expect(await c.disks.create(input)).toEqual(disk);
    await c.disks.get(disk.id); await c.disks.delete(disk.id);
    expect(calls.map(c => c.method)).toEqual(['POST','GET','DELETE']);
    expect(calls[0].body).toEqual(input);
    await expect(c.disks.get('../other')).rejects.toThrow();
  });
});

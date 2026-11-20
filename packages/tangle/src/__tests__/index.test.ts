import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { expect, it } from 'vitest';
import { tangle } from '../index';

runProviderTestSuite({
  name: 'tangle',
  provider: tangle({}),
  supportsFilesystem: true,
  // Live output and interactive processes are not qualified for this package yet.
  supportsStreaming: false,
  supportsProcesses: false,
  skipIntegration: !process.env.TANGLE_API_KEY,
});

it('sends the selected agent mode on create and preserves the server default', async () => {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/sandboxes') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Test receiver recorded the create request.' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const defaults = tangle({ apiKey: 'test-only', baseUrl });
    const commands = tangle({ apiKey: 'test-only', baseUrl, agent: false });
    const refusal = { status: 400, code: 'VALIDATION_ERROR' };
    await expect(defaults.instances.create({})).rejects.toMatchObject(refusal);
    await expect(defaults.instances.create({ agent: false })).rejects.toMatchObject(refusal);
    await expect(commands.instances.create({})).rejects.toMatchObject(refusal);
    await expect(commands.instances.create({ agent: true })).rejects.toMatchObject(refusal);
    await expect(defaults.instances.create({ agent: 'false' })).rejects.toThrow(/agent must be a boolean/);
    expect(requests).toHaveLength(4);
    expect(requests[0]).not.toHaveProperty('agent');
    expect(requests.slice(1).map(request => request.agent)).toEqual([false, false, true]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

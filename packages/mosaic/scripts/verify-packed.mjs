// Synthetic localhost checks for a clean-installed package, not a production benchmark.
// Start Node with NODE_EXTRA_CA_CERTS=packages/mosaic/src/__tests__/fixtures/tls-cert.pem.
import { createSecureServer } from 'node:http2';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const [entry, format = 'esm', transport = 'default'] = process.argv.slice(2);
assert(entry, 'Pass an absolute clean-installed dist entry, format (esm/cjs), and expected transport (h2/native).');
const fixtures = new URL('../src/__tests__/fixtures/', import.meta.url);
const fixture = name => readFileSync(new URL(name, fixtures));
const { mosaic } = format === 'cjs'
  ? createRequire(import.meta.url)(entry)
  : await import(pathToFileURL(entry));
const server = createSecureServer({
  key: fixture('tls-key.pem'), cert: fixture('tls-cert.pem'), allowHTTP1: true,
});
const sessions = new Set();
const sockets = new Set();
const versions = new Set();
const allocations = new Set();
const credentials = new Set();
let attempts = 0;
let created = 0;
let active = 0;
let peak = 0;
let tcpCount = 0;
let nativeCalls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  nativeCalls += 1;
  return nativeFetch(...args);
};
server.on('session', session => {
  sessions.add(session);
  session.on('error', () => {});
});
server.on('connection', socket => {
  tcpCount += 1;
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
server.on('request', async (request, response) => {
  request.on('error', () => {});
  response.on('error', () => {});
  attempts += 1;
  versions.add(request.httpVersion);
  credentials.add(request.headers.authorization);
  peak = Math.max(peak, ++active);
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    await sleep(3);
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/v1/sandboxes') {
      assert.equal(data.template, 'node-20');
      const id = `sbx-${++created}`;
      allocations.add(id);
      response.end(JSON.stringify({ id, state: 'running' }));
    } else if (request.method === 'POST') {
      assert.equal(data.cmd, 'node -v');
      response.end(JSON.stringify({ stdout: 'v20.0.0\n', stderr: '', exit_code: 0 }));
    } else {
      allocations.delete(request.url.split('/')[3]);
      response.writeHead(204);
      response.end();
    }
  } catch (error) {
    response.destroy(error);
  } finally {
    active -= 1;
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `https://127.0.0.1:${server.address().port}`;
const burstMs = [];
try {
  for (let burst = 0; burst < 2; burst += 1) {
    const started = performance.now();
    await Promise.all(Array.from({ length: 100 }, async (_, i) => {
      const provider = mosaic({
        baseUrl: url, apiKey: `fixture-${burst}-${i}`,
        ...(transport === 'native' ? { http2: false } : {}),
      });
      const sandbox = await provider.sandbox.create();
      try {
        const result = await sandbox.runCommand('node -v');
        assert.equal(result.stdout, 'v20.0.0\n');
        assert.equal(result.exitCode, 0);
      } finally {
        await sandbox.destroy();
      }
    }));
    assert.equal(allocations.size, 0);
    burstMs.push(Math.round(performance.now() - started));
  }
  assert.equal(attempts, 600);
  assert.equal(created, 200);
  assert.equal(credentials.size, 200);
  assert(peak > 4);
  if (transport === 'h2') {
    assert.deepEqual([...versions], ['2.0']);
    assert(sessions.size <= 4);
    assert.equal(nativeCalls, 0);
  }
  if (transport === 'native') assert.equal(nativeCalls, 600);
  console.log(JSON.stringify({
    entry, format, transport, node: process.version, attempts, created,
    remaining: allocations.size, credentials: credentials.size,
    protocols: [...versions], h2Sessions: sessions.size, tcpConnections: tcpCount,
    peak, nativeCalls, burstMs,
  }));
} finally {
  globalThis.fetch = nativeFetch;
  for (const session of sessions) session.destroy();
  for (const socket of sockets) socket.destroy();
  await new Promise(done => server.close(done));
}

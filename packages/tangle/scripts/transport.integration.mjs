// Real sockets, no SDK or transport stubs. Run on Node 24 for TypeScript stripping.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, constants } from 'node:http2';
import { discardResponseBody, http2Fetch, openConnections } from '../src/http2.ts';

const sessions = new Set();
const server = createServer();
let connections = 0;
let requests = 0;
server.on('session', (session) => {
  connections++;
  sessions.add(session);
  session.on('error', () => {});
  session.on('close', () => sessions.delete(session));
});
server.on('stream', (stream, headers) => {
  requests++;
  stream.on('error', () => {});
  const path = headers[':path'];
  if (path === '/reset') {
    stream.close(constants.NGHTTP2_INTERNAL_ERROR);
    return;
  }
  if (path === '/stall-headers') return;
  if (path === '/stall-body') {
    stream.respond({ ':status': 200, 'content-type': 'application/json' });
    stream.write('{');
    return;
  }
  if (path === '/stream') {
    stream.respond({ ':status': 200, 'content-type': 'text/event-stream' });
    stream.write('data: first\n\n');
    return;
  }
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  stream.on('end', () => {
    const status = path === '/absent' ? 404 : path === '/empty' ? 204 : 200;
    stream.respond({ ':status': status, 'content-type': 'application/json' });
    stream.end(status === 204 ? undefined : JSON.stringify({
      method: headers[':method'], path, authorization: headers.authorization,
      body: Buffer.concat(chunks).toString(),
    }));
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const url = (path) => new URL(path, origin);
try {
  openConnections(origin);
  while (connections < 4) await once(server, 'session');
  assert.equal(requests, 0, 'opening connections sends no requests or credentials');
  const replies = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
    const response = await http2Fetch(url('/echo?q=' + index), {
      method: 'POST', headers: { authorization: 'Bearer caller-' + index }, body: 'body-' + index,
    });
    return response.json();
  }));
  replies.forEach((reply, index) => {
    assert.deepEqual(reply, {
      method: 'POST', path: '/echo?q=' + index,
      authorization: 'Bearer caller-' + index, body: 'body-' + index,
    });
  });
  assert.equal(connections, 4);
  assert.equal(requests, 100);
  // Buffered replies preserve one-shot consumption and native stream behavior.
  for (const method of ['text', 'json', 'arrayBuffer', 'bytes', 'blob']) {
    const response = await http2Fetch(url('/echo'));
    const clone = response.clone();
    response.headers.set('x-caller', 'original');
    assert.equal(clone.headers.has('x-caller'), false);
    assert.equal(response.bodyUsed, false);
    await response[method]();
    assert.equal(response.bodyUsed, true);
    await assert.rejects(response.text(), TypeError);
    assert.throws(() => response.clone(), TypeError);
    const native = new Response('{}');
    await native[method]();
    assert.equal(response.body.locked, native.body.locked);
    assert.throws(() => response.body.getReader(), TypeError);
    assert.equal((await clone.json()).path, '/echo');
  }
  const locked = await http2Fetch(url('/echo'));
  const readerBeforeRead = locked.body.getReader();
  assert.equal(locked.bodyUsed, false);
  await assert.rejects(locked.json(), TypeError);
  assert.throws(() => locked.clone(), TypeError);
  readerBeforeRead.releaseLock();
  const streamedClone = locked.clone();
  assert.deepEqual(await locked.json(), await streamedClone.json());
  const typed = await http2Fetch(url('/echo'));
  void typed.body;
  typed.headers.set('content-type', 'application/octet-stream');
  assert.equal((await typed.blob()).type, 'application/octet-stream');
  const form = await http2Fetch(url('/echo'));
  void form.body;
  form.headers.set('content-type', 'application/x-www-form-urlencoded');
  const formClone = form.clone();
  assert.deepEqual([...await form.formData()], [...await formClone.formData()]);
  assert.equal(form.bodyUsed, true);
  const discarded = await http2Fetch(url('/echo'));
  await discardResponseBody(discarded);
  assert.equal(discarded.bodyUsed, true);
  await assert.rejects(discarded.json(), TypeError);
  assert.equal((await discarded.body.getReader().read()).done, true);
  assert.equal((await http2Fetch(url('/absent'))).status, 404);
  assert.equal(await (await http2Fetch(url('/empty'), { method: 'DELETE' })).text(), '');
  const authenticated = await http2Fetch(url('/echo'), {
    method: 'POST', headers: new Headers({ authorization: 'caller-value' }), body: '{}',
  }, { authorization: 'Bearer provider-value', timeoutMs: 1_000 });
  assert.equal((await authenticated.json()).authorization, 'Bearer provider-value');
  const sentBeforeAbort = requests;
  await assert.rejects(http2Fetch(url('/echo'), { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(requests, sentBeforeAbort);
  for (const path of ['/stall-headers', '/stall-body']) {
    await assert.rejects(http2Fetch(url(path), { signal: AbortSignal.timeout(30) }), { name: 'TimeoutError' });
    await assert.rejects(http2Fetch(url(path), {}, { timeoutMs: 30 }), { name: 'TimeoutError' });
  }
  await assert.rejects(http2Fetch(url('/reset')));
  const controller = new AbortController();
  const response = await http2Fetch(url('/stream'), { signal: controller.signal });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  controller.abort();
  await assert.rejects(reader.read(), { name: 'AbortError' });

  // Graceful GOAWAY drains existing streams. A later request gets a new session.
  for (const session of sessions) session.goaway();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await http2Fetch(url('/echo'))).status, 200);
  assert.ok(connections > 4);

  // Import-only use must exit on its own even with an endpoint configured.
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { openConnections } from ${JSON.stringify(new URL('../src/http2.ts', import.meta.url).href)}; openConnections(${JSON.stringify(origin)});`,
  ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 2_000 });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0, stderr);
  assert.equal(signal, null);
  console.log('PASS: 100 concurrent streams / 4 sessions; buffered body consumption, cloning, locking and discard; per-request credentials; no import requests; 404/204; pre-abort; header/body deadlines; reset; streaming abort; GOAWAY replacement; idle process exit.');
} finally {
  for (const session of sessions) session.destroy();
  server.close();
  await once(server, 'close');
}

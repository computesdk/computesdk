// Exercise the built provider over real HTTP/2 sockets, including rejected wire replies.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http2';
import { spawn } from 'node:child_process';
import { tangle } from '../dist/index.mjs';
import { SandboxInstance, PartialFailureError, AuthError, QuotaError, ServerError, ValidationError, SandboxError, TimeoutError } from '@tangle-network/sandbox';

const sessions = new Set();
const requests = [];
let reply;
const server = createServer();
server.on('session', (session) => {
  sessions.add(session);
  session.on('error', () => {});
  session.on('close', () => sessions.delete(session));
});
server.on('stream', (stream, headers) => {
  stream.on('error', () => {});
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  stream.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const request = { method: headers[':method'], path: headers[':path'], headers, body };
    requests.push(request);
    const response = reply(request);
    if (!response) return;
    stream.respond({ ':status': response.status ?? 200, 'content-type': 'application/json', ...response.headers });
    stream.end(response.status === 204 ? undefined : JSON.stringify(response.body));
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const provider = tangle({ apiKey: 'socket-test-only', baseUrl, image: 'default-image', cpu: 1, memory: 512, disk: 2 });
const receipt = { ownerContext: 'isolated', injectedSecrets: [], idempotencyKeyApplied: true, outcome: 'created' };
const ready = () => ({
  id: 'allocation / unicode-é', name: 'socket-check', status: 'running',
  filesystemIncarnationId: 'incarnation', filesystemIncarnationProvenance: 'fresh', filesystemIncarnationReadiness: 'ready',
  createReceipt: structuredClone(receipt), createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T00:02:00Z',
  connection: { runtimeUrl: `${baseUrl}/runtime`, authToken: 'test-runtime-only', edgeStatus: 'ready' },
  resources: { cpuCores: 2, memoryMB: 1024, diskGB: 4 }, metadata: { purpose: 'socket' },
});
const idPath = '/v1/sandboxes/' + encodeURIComponent(ready().id);
const path = idPath + '/runtime/process/spawn';
const reset = (fn) => { requests.length = 0; reply = fn; };
try {
  reset((request) => {
    if (request.method === 'DELETE') return { status: 204 };
    if (request.path.startsWith('/v1/sandboxes?') && request.method === 'GET') return { body: { sandboxes: [ready()] } };
    if (request.method === 'GET' || request.path === '/v1/sandboxes') return { body: ready() };
    return { body: { data: request.body.blocking ? { stdout: 'ordinary output', stderr: 'ordinary error', exitCode: 7 } : { pid: 123 } } };
  });
  const box = await provider.instances.create({
    image: 'custom-image', name: 'socket-check', idempotencyKey: 'stable-key', cpu: 2, memory: 1024, disk: 4,
    timeout: 120001, envs: { PUBLIC_SETTING: 'value' }, metadata: { purpose: 'socket' },
  });
  assert.deepEqual(requests[0].body, {
    name: 'socket-check', idempotencyKey: 'stable-key', environment: 'custom-image', agent: false, ephemeral: true,
    resources: { cpuCores: 2, memoryMB: 1024, diskGB: 4 }, env: { PUBLIC_SETTING: 'value' }, metadata: { purpose: 'socket' },
    egressPolicy: { mode: 'open' }, maxLifetimeSeconds: 121, ownerContext: 'isolated', secrets: [], sshEnabled: false,
  });
  assert.equal(requests[0].headers['idempotency-key'], 'stable-key');
  const result = await box.runCommand('printf "%s" "$PUBLIC_SETTING"', { cwd: '/tmp', env: { PUBLIC_SETTING: 'command' }, timeout: 4321 });
  assert.deepEqual({ ...result, durationMs: 0 }, { stdout: 'ordinary output', stderr: 'ordinary error', exitCode: 7, durationMs: 0 });
  assert.deepEqual(requests[1].body, {
    executable: '/bin/sh', args: ['-c', 'printf "%s" "$PUBLIC_SETTING"'], cwd: '/tmp', env: { PUBLIC_SETTING: 'command' }, timeoutMs: 4321, blocking: true,
  });
  assert.equal(requests[1].path, path);
  assert.equal(requests.length, 2, 'create plus blocking spawn has no readiness or result polling');
  const background = await box.runCommand('sleep 1', { background: true });
  assert.equal(background.exitCode, 0);
  assert.equal(requests[2].body.blocking, false);
  const native = box.getInstance();
  assert.ok(native instanceof SandboxInstance);
  assert.equal(box.getInstance(), native);
  assert.equal(native.connection.runtimeUrl, `${baseUrl}/runtime`);
  assert.deepEqual(native.resources, ready().resources);
  assert.equal(native.createdAt.toISOString(), ready().createdAt.replace('Z', '.000Z'));
  assert.equal(requests.length, 3, 'native materialization sends no request');
  assert.equal((await box.getInfo()).timeout, 120000);
  const attached = await provider.instances.getById(ready().id);
  assert.ok(attached.getInstance() instanceof SandboxInstance);
  await attached.runCommand('echo attached');
  const listed = await provider.instances.list();
  assert.equal(listed.length, 1);
  await listed[0].runCommand('echo listed');
  await box.destroy();
  assert.ok(requests.every((r) => r.headers.authorization === 'Bearer socket-test-only'));

  // Both published formats start cold, keep SDK code off a successful lifecycle,
  // and still expose a real synchronous native handle on demand.
  for (const extension of ['mjs', 'js']) {
    const entry = new URL('../dist/index.' + extension, import.meta.url).href;
    const code = `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const require = createRequire(${JSON.stringify(import.meta.url)});
      const { tangle } = await import(${JSON.stringify(entry)});
      const sdkPath = require.resolve('@tangle-network/sandbox');
      const box = await tangle({ apiKey: 'socket-test-only', baseUrl: ${JSON.stringify(baseUrl)} }).instances.create();
      await box.runCommand('echo cold-module');
      assert.equal(require.cache[sdkPath], undefined);
      assert.equal(box.getInstance().constructor.name, 'SandboxInstance');
      assert.ok(require.cache[sdkPath]);
      await box.destroy();
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [codeValue, signal] = await once(child, 'exit');
    assert.equal(codeValue, 0, stderr);
    assert.equal(signal, null);
  }

  // Every safety predicate fails closed; cleanup is allowed only by an owned receipt.
  const mutations = [
    (d) => { delete d.createReceipt; },
    (d) => { delete d.createReceipt.idempotencyKeyApplied; },
    (d) => { d.createReceipt.ownerContext = 'inherit'; },
    (d) => { delete d.createReceipt.injectedSecrets; },
    (d) => { d.createReceipt.injectedSecrets = ['unexpected']; },
    (d) => { d.createReceipt.injectedSecrets = {}; },
    (d) => { delete d.filesystemIncarnationId; },
    (d) => { d.filesystemIncarnationProvenance = 'invalid'; },
    (d) => { d.filesystemIncarnationReadiness = 'transitioning'; },
    (d) => { d.status = 'provisioning'; },
    (d) => { d.status = 'stopped'; },
  ];
  for (const mutate of mutations) {
    const data = ready(); mutate(data);
    reset((r) => r.method === 'DELETE' ? { status: 204 } : { body: data });
    await assert.rejects(provider.instances.create({ idempotencyKey: 'failure-key' }), PartialFailureError);
    const owns = data.createReceipt?.outcome === 'created' && data.createReceipt?.idempotencyKeyApplied === true;
    assert.deepEqual(requests.map((r) => r.method), owns ? ['POST', 'DELETE'] : ['POST']);
  }
  for (const outcome of ['idempotent_replay', 'unknown']) {
    const data = ready(); data.status = 'pending'; data.createReceipt.outcome = outcome;
    reset(() => ({ body: data }));
    await assert.rejects(provider.instances.create({ idempotencyKey: 'failure-key' }), PartialFailureError);
    assert.equal(requests.length, 1);
  }
  reset((r) => r.method === 'DELETE' ? { status: 500, body: { message: 'retirement failed' } } : { body: { ...ready(), status: 'stopped' } });
  await assert.rejects(provider.instances.create({ idempotencyKey: 'failure-key' }), (error) =>
    error instanceof AggregateError && error.cause instanceof PartialFailureError && error.errors[1].code === 'SANDBOX_DELETE_FAILED');

  for (const [status, body, type] of [
    [401, { message: 'unauthorized' }, AuthError],
    [429, { message: 'capacity', code: 'RATE_LIMIT_EXCEEDED', etaSeconds: 9 }, QuotaError],
    [503, { message: 'unavailable', code: 'SERVICE_UNAVAILABLE' }, ServerError],
  ]) {
    reset(() => ({ status, body, headers: { 'retry-after': '2' } }));
    await assert.rejects(provider.instances.create(), (error) => {
      assert.ok(error instanceof type);
      assert.equal(error.retryAfterMs, 2000);
      if (status === 429) {
        assert.equal(error.etaSeconds, 9);
        assert.equal(error.createFailureDisposition, 'not-admitted');
      }
      return true;
    });
    assert.equal(requests.length, 1, 'no create replay');
  }
  reset(() => ({ body: { data: { stdout: '', stderr: '' } } }));
  await assert.rejects(box.runCommand('false'), ServerError);
  await assert.rejects(box.runCommand('true', { timeout: 99 }), ValidationError);
  await assert.rejects(box.runCommand('true', { background: true }), /background process/);
  reset(() => ({ status: 404, body: { message: 'absent' } }));
  await box.destroy();
  reset(() => ({ status: 403, body: { message: 'denied' } }));
  await assert.rejects(box.destroy(), (error) => error instanceof SandboxError && error.code === 'SANDBOX_DELETE_FAILED');
  reset(() => undefined);
  for (const createTimeout of [-1, 0.5, NaN, Infinity, 2 ** 32, 'invalid']) {
    let expected;
    try { AbortSignal.timeout(createTimeout); } catch (error) { expected = error.constructor; }
    await assert.rejects(tangle({ apiKey: 'socket-test-only', baseUrl, createTimeout }).instances.create(), expected);
  }
  assert.equal(requests.length, 0, 'invalid create budgets fail before sending a POST');
  reset(() => undefined);
  await assert.rejects(tangle({ apiKey: 'socket-test-only', baseUrl, createTimeout: 20 }).instances.create(), TimeoutError);
  reset(() => undefined);
  await assert.rejects(provider.instances.create({ signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(requests.length, 0);
  console.log('PASS: direct create/spawn/delete wire contract, cold ESM/CJS native loading, native access/lookup/list/info, malformed receipts and readiness, owned-only cleanup, aggregate cleanup failure, typed errors/metadata, no replay, deadlines and pre-abort.');
} finally {
  for (const session of sessions) session.destroy();
  server.close();
  await once(server, 'close');
}

// Zero-delay mock in a separate process so server work does not block the client.
import assert from 'node:assert/strict';
import { createServer } from 'node:http2';
import { once } from 'node:events';

const server = createServer();
const sessions = new Set();
const requests = { create: 0, exec: 0, destroy: 0, other: 0 };
const live = new Set();
let acceptedSessions = 0;
server.on('session', (session) => {
  acceptedSessions++;
  sessions.add(session);
  session.on('error', () => {});
  session.on('close', () => sessions.delete(session));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;
server.on('stream', (stream, headers) => {
  stream.on('error', () => {});
  let body = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => { body += chunk; });
  stream.on('end', () => {
    try {
      assert.equal(headers.authorization, 'Bearer client-control');
      const path = headers[':path'];
      let response;
      if (headers[':method'] === 'POST' && path === '/v1/sandboxes') {
        requests.create++;
        const input = JSON.parse(body);
        assert.equal(input.ownerContext, 'isolated');
        assert.equal(input.agent, false);
        assert.equal(input.ephemeral, true);
        assert.equal(input.sshEnabled, false);
        assert.deepEqual(input.secrets, []);
        assert.deepEqual(input.egressPolicy, { mode: 'open' });
        assert.equal(input.backend, undefined);
        assert.equal(input.teamId, undefined);
        const id = 'client-control-' + requests.create;
        live.add(id);
        response = {
          id, name: input.name, status: 'running', createdAt: new Date().toISOString(),
          filesystemIncarnationId: 'fs-' + id,
          filesystemIncarnationProvenance: 'fresh', filesystemIncarnationReadiness: 'ready',
          createReceipt: { outcome: 'created', idempotencyKeyApplied: true, ownerContext: 'isolated', injectedSecrets: [] },
          connection: { runtimeUrl: `${baseUrl}/v1/sandboxes/${id}/runtime`, authToken: 'runtime-control', edgeStatus: 'ready' },
        };
      } else if (headers[':method'] === 'POST' && /^\/v1\/sandboxes\/[^/]+\/runtime\/process\/spawn$/.test(path)) {
        requests.exec++;
        const input = JSON.parse(body);
        assert.equal(input.blocking, true);
        assert.ok(input.args.includes('node -v'));
        assert.ok(live.has(path.split('/')[3]));
        response = { data: { stdout: process.version + '\n', stderr: '', exitCode: 0 } };
      } else if (headers[':method'] === 'DELETE' && /^\/v1\/sandboxes\/[^/?]+$/.test(path)) {
        requests.destroy++;
        assert.ok(live.delete(path.split('/')[3]));
        response = { success: true, outcome: 'accepted' };
      } else {
        requests.other++;
        throw new Error('Unexpected request: ' + headers[':method'] + ' ' + path);
      }
      stream.respond({ ':status': 200, 'content-type': 'application/json' });
      stream.end(JSON.stringify(response));
    } catch (error) {
      stream.respond({ ':status': 400, 'content-type': 'application/json' });
      stream.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
});

process.send({ baseUrl });
process.on('message', (message) => {
  if (message === 'stats') process.send({ connections: acceptedSessions, requests, live: live.size });
});
process.on('disconnect', () => {
  for (const session of sessions) session.destroy();
  server.close();
});

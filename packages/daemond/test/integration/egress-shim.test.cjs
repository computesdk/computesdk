'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');

const SHIM = path.join(__dirname, '..', '..', 'dist', 'runtime', 'egress-shim.js');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitClose(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Spawn the shim; resolve {proc, port, caCertPath} once EGRESS_READY prints. */
function startShim(config, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-it-'));
  const configPath = path.join(tmp, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const proc = spawn(process.execPath, [SHIM, configPath], {
    env: { ...process.env, EGRESS_DIR: tmp, ...opts.env },
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`shim did not become ready: ${out}`));
    }, 20000);
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.stdout.on('data', (d) => {
      out += d.toString();
      for (const line of out.split('\n')) {
        if (!line.startsWith('EGRESS_READY ')) continue;
        clearTimeout(timer);
        resolve({ proc, tmp, ready: JSON.parse(line.slice('EGRESS_READY '.length)) });
        return;
      }
      if (out.includes('EGRESS_ERROR ')) {
        clearTimeout(timer);
        reject(new Error(`shim reported error: ${out}`));
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`shim exited ${code}: ${out}`));
    });
  });
}

function killShim(proc) {
  return new Promise((resolve) => {
    proc.on('exit', resolve);
    proc.kill('SIGTERM');
    setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000).unref();
  });
}

/** Start a JSON envelope injector; received envelopes collect into `envelopes`. */
function startInjector(envelopes, response) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        envelopes.push({ method: req.method, path: req.url, body: JSON.parse(body) });
        const payload = typeof response === 'function' ? response(envelopes.at(-1)) : response;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Open a CONNECT tunnel through the proxy. Returns the established socket. */
function connectThrough(proxyPort, authority) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxyPort, '127.0.0.1');
    sock.once('connect', () => sock.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\r\n\r\n')) {
        const statusLine = buf.split('\r\n')[0];
        if (/ 200/.test(statusLine)) resolve(sock);
        else reject(new Error(`CONNECT ${authority} failed: ${statusLine}`));
      }
    });
    sock.once('error', reject);
  });
}

function sendRaw(sock, data) {
  return new Promise((resolve) => {
    let out = '';
    sock.write(data);
    const onData = (d) => {
      out += d.toString();
      if (out.includes('\r\n\r\n')) {
        sock.off('data', onData);
        resolve(out);
      }
    };
    sock.on('data', onData);
  });
}

function sendRawUntilBody(sock, data, expected) {
  return new Promise((resolve) => {
    let out = '';
    sock.write(data);
    const onData = (d) => {
      out += d.toString();
      if (out.includes(expected)) {
        sock.off('data', onData);
        resolve(out);
      }
    };
    sock.on('data', onData);
  });
}

describe('egress shim', () => {
  test('host matching and url helpers', () => {
    const shim = require(SHIM);
    assert.equal(shim.matchCredentialedHost('api.openai.com', ['api.openai.com']), true);
    assert.equal(shim.matchCredentialedHost('other.openai.com', ['api.openai.com']), false);
    assert.equal(shim.matchCredentialedHost('x.api.openai.com', ['*.api.openai.com']), true);
    assert.equal(shim.matchCredentialedHost('api.openai.com', ['*.api.openai.com']), true);
    assert.equal(shim.matchCredentialedHost('api.openai.com:443', ['api.openai.com']), true);
    assert.equal(shim.matchCredentialedHost('api.openai.com', []), false);
    assert.equal(shim.splitAuthority('[::1]:8080').host, '::1');
    assert.equal(shim.splitAuthority('host:123').port, 123);
    assert.equal(shim.splitAuthority('host').port, null);
    assert.equal(
      shim.buildRequestUrl('https', undefined, 'api.x.com', '/a?b=1'),
      'https://api.x.com/a?b=1'
    );
    assert.equal(
      shim.buildRequestUrl('http', undefined, 'h', 'http://other.com/x'),
      'http://other.com/x'
    );
    assert.equal(
      shim.buildRequestUrl('http', 'real.h:81', 'h', '/x'),
      'http://real.h:81/x'
    );
    const sanitized = shim.sanitizeRequestHeaders([
      ['proxy-connection', 'keep-alive'],
      ['proxy-authorization', 'Basic x'],
      ['connection', 'keep-alive, x-drop'],
      ['x-drop', '1'],
      ['x-keep', '1'],
    ]);
    // connection-listed tokens and proxy headers are dropped
    assert.deepEqual(sanitized, [['x-keep', '1']]);
  });

  test('fails cleanly without openssl', async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-it-nossl-'));
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
      injectorUrl: 'http://127.0.0.1:1', credentialedHosts: ['x'], mode: 'passthrough', port: 0,
    }));
    const proc = spawn(process.execPath, [SHIM, path.join(tmp, 'config.json')], {
      env: { EGRESS_DIR: tmp, PATH: '/nonexistent' },
    });
    let out = '';
    proc.stderr.on('data', (d) => { out += d; });
    proc.stdout.on('data', (d) => { out += d; });
    const code = await new Promise((r) => proc.on('exit', r));
    assert.equal(code, 1);
    assert.match(out, /EGRESS_ERROR.*openssl/);
  });

  describe('router behavior', () => {
    let upstream, upstreamPort;
    let injector, injectorPort;
    const envelopes = [];

    // Plain-HTTP upstream used for passthrough CONNECT targets.
    const UPSTREAM_BODY = 'upstream-ok';

    test('setup', async () => {
      upstream = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(UPSTREAM_BODY);
      });
      await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
      upstreamPort = upstream.address().port;

      ({ server: injector, port: injectorPort } = await startInjector(envelopes, {
        status: 201,
        headers: { 'content-type': 'application/json', 'x-upstream': 'yes' },
        bodyB64: Buffer.from('injected-response').toString('base64'),
      }));
    });

    test('CONNECT to credentialed host relays each request to the injector', async (t) => {
      const shim = await startShim({
        injectorUrl: `http://127.0.0.1:${injectorPort}/inject`,
        injectorToken: 'tok-1',
        credentialedHosts: ['api.example.test'],
        mode: 'passthrough',
        port: 0,
      });
      t.after(() => killShim(shim.proc));
      const ca = fs.readFileSync(shim.ready.caCertPath, 'utf8');
      assert.match(ca, /BEGIN CERTIFICATE/);

      const sock = await connectThrough(shim.ready.port, 'api.example.test:443');
      t.after(() => sock.destroy());
      const tlsSock = tls.connect({ socket: sock, servername: 'api.example.test', ca });
      await new Promise((res, rej) => {
        tlsSock.once('secureConnect', res);
        tlsSock.once('error', rej);
      });
      assert.equal(tlsSock.authorized, true);

      // Two requests over one connection (keep-alive).
      const marker = crypto.randomBytes(6).toString('hex');
      const first = sendRawUntilBody(
        tlsSock,
        `POST /v1/chat?m=${marker} HTTP/1.1\r\nHost: api.example.test\r\nContent-Length: 7\r\n\r\n{"a":1}`,
        'injected-response'
      );
      const second = sendRawUntilBody(
        tlsSock,
        'GET /v2 HTTP/1.1\r\nHost: api.example.test\r\n\r\n',
        'injected-response'
      );
      const [r1, r2] = await Promise.all([first, second]);
      assert.match(r1, /HTTP\/1\.1 201/);
      assert.match(r1, /x-upstream: yes/);
      assert.match(r1, /injected-response$/);
      assert.match(r2, /HTTP\/1\.1 201/);

      const first2 = envelopes.at(-2);
      const second2 = envelopes.at(-1);
      assert.equal(first2.method, 'POST');
      assert.equal(first2.path, '/inject');
      assert.equal(first2.body.token, 'tok-1');
      assert.equal(first2.body.request.method, 'POST');
      assert.equal(first2.body.request.url, `https://api.example.test/v1/chat?m=${marker}`);
      assert.equal(Buffer.from(first2.body.request.bodyB64, 'base64').toString(), '{"a":1}');
      assert.equal(second2.body.request.url, 'https://api.example.test/v2');
    });

    test('passthrough mode tunnels non-credentialed CONNECT upstream', async (t) => {
      const shim = await startShim({
        injectorUrl: `http://127.0.0.1:${injectorPort}`,
        injectorToken: 'tok-2',
        credentialedHosts: ['api.example.test'],
        mode: 'passthrough',
        port: 0,
      });
      t.after(() => killShim(shim.proc));

      const sock = await connectThrough(shim.ready.port, `127.0.0.1:${upstreamPort}`);
      t.after(() => sock.destroy());
      const out = await sendRawUntilBody(sock, 'GET /direct HTTP/1.1\r\nHost: x\r\n\r\n', UPSTREAM_BODY);
      assert.match(out, /HTTP\/1\.1 200/);
      assert.match(out, /upstream-ok/);
      // Nothing was relayed to the injector for this request.
      assert.equal(envelopes.at(-1).body.request.url.includes('/v2'), true);
    });

    test('allowlist mode denies non-credentialed CONNECT', async (t) => {
      const shim = await startShim({
        injectorUrl: `http://127.0.0.1:${injectorPort}`,
        injectorToken: 'tok-3',
        credentialedHosts: ['api.example.test'],
        mode: 'allowlist',
        port: 0,
      });
      t.after(() => killShim(shim.proc));

      const sock = net.connect(shim.ready.port, '127.0.0.1');
      t.after(() => sock.destroy());
      await new Promise((r) => sock.once('connect', r));
      const out = await sendRaw(sock, `CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\n\r\n`);
      assert.match(out, /HTTP\/1\.1 403/);
    });

    test('plain HTTP credentialed request relays via absolute URI', async (t) => {
      const shim = await startShim({
        injectorUrl: `http://127.0.0.1:${injectorPort}`,
        injectorToken: 'tok-4',
        credentialedHosts: ['plain.example.test'],
        mode: 'passthrough',
        port: 0,
      });
      t.after(() => killShim(shim.proc));

      const sock = net.connect(shim.ready.port, '127.0.0.1');
      t.after(() => sock.destroy());
      await new Promise((r) => sock.once('connect', r));
      const out = await sendRawUntilBody(
        sock,
        'GET http://plain.example.test/echo?q=1 HTTP/1.1\r\nHost: plain.example.test\r\nConnection: close\r\n\r\n',
        'injected-response'
      );
      assert.match(out, /HTTP\/1\.1 201/);
      assert.equal(envelopes.at(-1).body.request.url, 'http://plain.example.test/echo?q=1');
      assert.equal(envelopes.at(-1).body.token, 'tok-4');
    });

    test('teardown', async () => {
      await waitClose(upstream);
      await waitClose(injector);
    });
  });
});

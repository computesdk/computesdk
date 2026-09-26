// Local demo of the daemond dial-out tunnel prototype.
//
//   node demo.mjs            # local mode (default)
//   node demo.mjs --sandbox  # real-sandbox mode (needs public ingress)

import crypto from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTunnelServer } from './tunnel-server.mjs';
import { connectTunnel } from './tunnel-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function startSandboxHttpServer(port = 8787) {
  const big = crypto.randomBytes(5 * 1024 * 1024);
  const srv = http.createServer((req, res) => {
    if (req.url === '/hello') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ hello: 'from-sandbox', port }));
    } else if (req.url === '/echo' && req.method === 'POST') {
      req.pipe(res);
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-length': big.length, 'content-type': 'application/octet-stream' });
      res.end(big);
    } else if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' });
      let i = 0;
      const timer = setInterval(() => {
        res.write(`chunk-${i}\n`);
        if (++i === 5) { clearInterval(timer); res.end(); }
      }, 200);
      req.on('close', () => clearInterval(timer));
    } else {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

async function localDemo() {
  const TOKEN = crypto.randomBytes(16).toString('hex');
  const server = createTunnelServer({
    port: 0,
    authenticate: (t) => (t === TOKEN ? 'sandbox-local' : t === TOKEN + '-strict' ? 'sandbox-strict' : null),
  });
  await server.ready;
  const url = `ws://127.0.0.1:${server.port}/tunnel`;

  const sandboxHttp = await startSandboxHttpServer(8787);

  const client = connectTunnel({ url, token: TOKEN });
  const conn = await server.waitFor('sandbox-local');
  check('tunnel established (auth via query + auth frame)', conn.sandboxId === 'sandbox-local');

  // /hello
  const res = await conn.fetch('http://127.0.0.1:8787/hello');
  const body = await res.json();
  check('GET /hello', res.status === 200 && body.hello === 'from-sandbox', JSON.stringify(body));

  // /echo POST 100KB
  const echoBody = crypto.randomBytes(100 * 1024);
  const echoRes = await conn.fetch('http://127.0.0.1:8787/echo', { method: 'POST', body: echoBody });
  const echoed = Buffer.from(await echoRes.arrayBuffer());
  check('POST /echo 100KB roundtrip', echoed.equals(echoBody), `${echoed.length} bytes`);

  // /big 5 MiB + throughput
  const t0 = performance.now();
  const bigRes = await conn.fetch('http://127.0.0.1:8787/big');
  let bigBytes = 0;
  for await (const chunk of bigRes.body) bigBytes += chunk.length;
  const bigSecs = (performance.now() - t0) / 1000;
  const mbps = (bigBytes / 1024 / 1024 / bigSecs).toFixed(1);
  check('GET /big 5 MiB', bigBytes === 5 * 1024 * 1024, `${mbps} MB/s`);

  // /slow incremental chunks
  const slowRes = await conn.fetch('http://127.0.0.1:8787/slow');
  const slowStart = performance.now();
  const chunkTimes = [];
  for await (const _ of slowRes.body) chunkTimes.push(performance.now() - slowStart);
  const incremental = chunkTimes.length === 5 &&
    chunkTimes.every((t, i) => i === 0 || t - chunkTimes[i - 1] > 50);
  check('GET /slow streamed incrementally', incremental,
    chunkTimes.map((t) => `${t.toFixed(0)}ms`).join(', '));

  // latency: 50 sequential /hello
  const lat = [];
  for (let i = 0; i < 50; i++) {
    const s = performance.now();
    await (await conn.fetch('http://127.0.0.1:8787/hello')).text();
    lat.push(performance.now() - s);
  }
  lat.sort((a, b) => a - b);
  const p50 = lat[Math.floor(lat.length * 0.5)].toFixed(2);
  const p99 = lat[Math.floor(lat.length * 0.99)].toFixed(2);
  console.log(`  latency /hello: p50=${p50}ms p99=${p99}ms`);

  // 20 concurrent
  const conc = await Promise.all(
    Array.from({ length: 20 }, () => conn.fetch('http://127.0.0.1:8787/hello').then((r) => r.json())),
  );
  check('20 concurrent /hello', conc.every((b) => b.hello === 'from-sandbox'));

  // ECONNREFUSED
  try {
    await conn.open(9);
    check('open(9) ECONNREFUSED surfaces', false);
  } catch (e) {
    check('open(9) ECONNREFUSED surfaces', e.code === 'ECONNREFUSED', e.code);
  }

  // raw TCP forward via listen()
  const fwd = await conn.listen(0, 8787);
  const fwdPort = fwd.address().port;
  const fwdRes = await fetch(`http://127.0.0.1:${fwdPort}/hello`);
  const fwdBody = await fwdRes.json();
  check('raw TCP forward fetch /hello', fwdBody.hello === 'from-sandbox', `local :${fwdPort}`);

  // allowPorts on the client side
  const strictClient = connectTunnel({ url, token: TOKEN + '-strict', allowPorts: (p) => p === 8787 });
  const strictConn = await server.waitFor('sandbox-strict');
  try {
    await strictConn.open(9999);
    check('allowPorts rejects non-8787 port', false);
  } catch (e) {
    check('allowPorts rejects non-8787 port', e.code === 'PORT_NOT_ALLOWED', e.code);
  }
  strictClient.close();

  // reconnect: terminate the WS server-side, client should reconnect
  const tR = performance.now();
  conn.ws.terminate();
  const conn2 = await server.waitFor('sandbox-local', { timeoutMs: 15_000 });
  const reconnectMs = performance.now() - tR;
  check('client reconnected after terminate', conn2 !== conn && !conn2._closed, `${reconnectMs.toFixed(0)}ms`);
  const res2 = await conn2.fetch('http://127.0.0.1:8787/hello');
  check('fetch works after reconnect', (await res2.json()).hello === 'from-sandbox');

  // shutdown
  client.close();
  fwd.close();
  conn2.close();
  await server.close();
  await new Promise((r) => sandboxHttp.close(r));

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  console.log(`latency p50=${p50}ms p99=${p99}ms | /big ${mbps} MB/s | reconnect ${reconnectMs.toFixed(0)}ms`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

async function sandboxDemo() {
  const publicUrl = process.env.TUNNEL_PUBLIC_URL;
  if (!publicUrl) {
    console.log('no public ingress; skipping sandbox mode');
    process.exit(0);
  }
  const { compute } = await import('computesdk');
  const TOKEN = crypto.randomBytes(16).toString('hex');
  const server = createTunnelServer({
    port: 0,
    authenticate: (t) => (t === TOKEN ? 'sandbox-remote' : null),
  });
  await server.ready;

  const sandbox = await compute.sandbox.create();
  console.log(`sandbox created: ${sandbox.sandboxId}`);
  try {
    const clientSrc = await readFile(path.join(__dirname, 'tunnel-client.mjs'), 'utf8');
    const protoSrc = await readFile(path.join(__dirname, 'protocol.mjs'), 'utf8');
    await sandbox.filesystem.writeFile('/tmp/protocol.mjs', protoSrc);
    await sandbox.filesystem.writeFile('/tmp/tunnel-client.mjs', clientSrc);
    await sandbox.runCommand(
      `node -e 'require("http").createServer((q,s)=>{s.writeHead(200,{"content-type":"application/json"});s.end(JSON.stringify({hello:"from-sandbox"}))}).listen(8787,"127.0.0.1")'`,
      { background: true },
    );
    await sandbox.runCommand(
      `node /tmp/tunnel-client.mjs '${publicUrl}'`,
      { background: true, env: { TUNNEL_TOKEN: TOKEN } },
    );
    const conn = await server.waitFor('sandbox-remote', { timeoutMs: 60_000 });
    const t0 = performance.now();
    const res = await conn.fetch('http://127.0.0.1:8787/hello');
    console.log('response:', await res.text(), `(${(performance.now() - t0).toFixed(0)}ms)`);
  } finally {
    await server.close();
    await sandbox.destroy();
  }
}

const wantSandbox = process.argv.includes('--sandbox') || !!process.env.TUNNEL_PUBLIC_URL;
if (wantSandbox && process.env.COMPUTESDK_API_KEY) {
  console.log('sandbox mode: tunnel server must be reachable from the sandbox via TUNNEL_PUBLIC_URL (wss://host/tunnel)');
  sandboxDemo().catch((e) => { console.error(e); process.exit(1); });
} else if (wantSandbox) {
  console.log('COMPUTESDK_API_KEY not set; sandbox mode requires it plus a publicly reachable TUNNEL_PUBLIC_URL');
  console.log('no public ingress; skipping sandbox mode');
  process.exit(0);
} else {
  localDemo().catch((e) => { console.error(e); process.exit(1); });
}

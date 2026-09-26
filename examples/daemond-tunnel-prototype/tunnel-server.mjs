// Tunnel server — the control-plane side.
//
// Uses the `ws` package (server side may have deps; only the in-sandbox client
// must be dependency-free). Serves WebSocket upgrades on <server|port>/tunnel.
//
//   const ts = createTunnelServer({ port: 8080, authenticate: (t) => ... });
//   const conn = await ts.waitFor('sandbox-123');
//   const res = await conn.fetch('http://127.0.0.1:8787/hello');

import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { Duplex, Readable } from 'node:stream';
import { WebSocketServer } from 'ws';
import {
  encodeData,
  decodeData,
  MAX_FRAME_PAYLOAD,
  createStreamIdAllocator,
} from './protocol.mjs';

const AUTH_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_REPLACED = 4409;

class TunnelConnection extends EventEmitter {
  constructor(ws, sandboxId) {
    super();
    this.ws = ws;
    this.sandboxId = sandboxId;
    this.stats = { streamsOpen: 0, bytesIn: 0, bytesOut: 0 };
    this._allocId = createStreamIdAllocator();
    this._pending = new Map(); // id -> { resolve, reject, duplex? }
    this._servers = new Set();
    this._closed = false;

    ws.on('message', (data, isBinary) => this._onMessage(data, isBinary));
    ws.on('close', () => this._onClose());
    ws.on('error', () => {});
  }

  _send(obj) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(obj));
  }

  _onMessage(data, isBinary) {
    if (isBinary) {
      const { id, payload } = decodeData(data);
      this.stats.bytesIn += payload.length;
      const entry = this._pending.get(id);
      if (entry?.duplex) entry.duplex.push(payload);
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg.t) {
      case 'opened': {
        const entry = this._pending.get(msg.id);
        if (entry && !entry.duplex) {
          entry.duplex = this._makeDuplex(msg.id);
          this.stats.streamsOpen++;
          entry.resolve(entry.duplex);
        }
        break;
      }
      case 'close': {
        const entry = this._pending.get(msg.id);
        if (entry?.duplex) {
          entry.duplex.push(null);
          this._pending.delete(msg.id);
          this.stats.streamsOpen--;
        }
        break;
      }
      case 'error': {
        const err = new Error(msg.message || msg.code);
        err.code = msg.code;
        const entry = this._pending.get(msg.id);
        if (entry) {
          this._pending.delete(msg.id);
          if (entry.duplex) {
            this.stats.streamsOpen--;
            entry.duplex.destroy(err);
          } else {
            entry.reject(err);
          }
        }
        break;
      }
      case 'ping':
        this._send({ t: 'pong', ts: msg.ts });
        break;
      case 'pong':
        this._lastPong = Date.now();
        break;
    }
  }

  _makeDuplex(id) {
    const conn = this;
    return new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        try {
          for (let off = 0; off < chunk.length; off += MAX_FRAME_PAYLOAD) {
            const frame = encodeData(id, chunk.subarray(off, off + MAX_FRAME_PAYLOAD));
            if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(frame);
          }
          conn.stats.bytesOut += chunk.length;
          cb();
        } catch (e) { cb(e); }
      },
      final(cb) {
        conn._send({ t: 'close', id });
        cb();
      },
      destroy(err, cb) {
        if (conn._pending.has(id)) {
          conn._pending.delete(id);
          conn.stats.streamsOpen--;
          conn._send({ t: 'close', id });
        }
        cb(err);
      },
    });
  }

  // Open a stream to host:port inside the sandbox; resolves with a Duplex.
  open(port, host = '127.0.0.1') {
    if (this._closed) return Promise.reject(new Error('tunnel closed'));
    const id = this._allocId();
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._send({ t: 'open', id, port, host });
    });
  }

  // Real HTTP client over a tunneled stream. input is a URL string; init
  // supports { method, headers, body } (string/Buffer/Uint8Array body).
  async fetch(input, init = {}) {
    const url = new URL(input);
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const duplex = await this.open(port, url.hostname || '127.0.0.1');
    const headers = { ...(init.headers || {}) };
    const body = init.body == null
      ? null
      : (typeof init.body === 'string' ? Buffer.from(init.body) : Buffer.from(init.body));

    return await new Promise((resolve, reject) => {
      duplex.on('error', (e) => req.destroy(e));
      const req = http.request({
        agent: false,
        createConnection: () => duplex,
        host: '127.0.0.1', // real socket is `duplex`; this only feeds the Host header
        port,
        path: url.pathname + url.search,
        method: init.method || (body ? 'POST' : 'GET'),
        headers: { host: url.host, ...headers },
      });
      req.on('error', reject);
      req.on('response', (res) => {
        const h = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        }
        const webBody = Readable.toWeb(res);
        resolve(new Response(webBody, { status: res.statusCode, headers: h }));
      });
      if (body) {
        if (!headers['content-length'] && !headers['Content-Length']) {
          req.setHeader('content-length', body.length);
        }
        req.end(body);
      } else {
        req.end();
      }
    });
  }

  // Raw TCP forward: local sockets on localPort are piped to remotePort in the sandbox.
  listen(localPort, remotePort, localHost = '127.0.0.1') {
    const server = net.createServer((socket) => {
      this.open(remotePort).then(
        (d) => {
          d.on('error', () => socket.destroy());
          socket.on('error', () => d.destroy());
          socket.pipe(d).pipe(socket);
        },
        () => socket.destroy(),
      );
    });
    this._servers.add(server);
    server.on('close', () => this._servers.delete(server));
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(localPort, localHost, () => resolve(server));
    });
  }

  _onClose() {
    if (this._closed) return;
    this._closed = true;
    for (const [, entry] of this._pending) {
      const err = new Error('tunnel closed');
      if (entry.duplex) entry.duplex.destroy(err);
      else entry.reject(err);
    }
    this._pending.clear();
    this.stats.streamsOpen = 0;
    for (const s of this._servers) s.close();
    this._servers.clear();
    this.emit('close');
  }

  close() {
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) {
      this.ws.close(1000);
    }
    this._onClose();
  }
}

export function createTunnelServer({ port, server, authenticate }) {
  const connections = new Map(); // sandboxId -> TunnelConnection
  const waiters = new Set();     // { sandboxId, resolve, timer }
  let httpServer = null;

  const wss = server
    ? new WebSocketServer({ noServer: true })
    : (httpServer = http.createServer(), new WebSocketServer({ noServer: true }));
  const target = server || httpServer;

  target.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/tunnel') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._upgradeToken = url.searchParams.get('token');
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws) => {
    ws.isAlive = true;
    let sandboxId = null;
    let conn = null;
    let lastPong = Date.now();
    let authenticated = false;

    const bind = (id) => {
      authenticated = true;
      sandboxId = id;
      conn = new TunnelConnection(ws, id);
      conn._lastPong = lastPong;
      const existing = connections.get(id);
      if (existing && existing.ws !== ws) existing.ws.close(CLOSE_REPLACED, 'replaced');
      connections.set(id, conn);
      for (const w of [...waiters]) {
        if (w.sandboxId === id) { clearTimeout(w.timer); waiters.delete(w); w.resolve(conn); }
      }
      ws.on('close', () => {
        if (connections.get(id) === conn) connections.delete(id);
      });
    };

    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(CLOSE_UNAUTHORIZED, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    const doAuth = async (token) => {
      try {
        const id = await authenticate(token);
        if (id) bind(id);
        else ws.close(CLOSE_UNAUTHORIZED, 'invalid token');
      } catch {
        ws.close(CLOSE_UNAUTHORIZED, 'auth error');
      }
    };

    if (ws._upgradeToken != null) {
      await doAuth(ws._upgradeToken);
    }

    ws.on('message', (data, isBinary) => {
      if (authenticated) return; // TunnelConnection listener handles from here
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.t === 'auth' && typeof msg.token === 'string') doAuth(msg.token);
      } catch {}
    });

    ws.on('close', () => clearTimeout(authTimer));
    ws.on('pong', () => { lastPong = Date.now(); if (conn) conn._lastPong = lastPong; });

    const pingTimer = setInterval(() => {
      if (Date.now() - lastPong > PING_INTERVAL_MS + PONG_TIMEOUT_MS) {
        ws.terminate();
        return;
      }
      ws.ping();
    }, PING_INTERVAL_MS);
    ws.on('close', () => clearInterval(pingTimer));
  });

  const ready = httpServer
    ? new Promise((resolve) => httpServer.listen(port ?? 0, '127.0.0.1', resolve))
    : Promise.resolve();

  return {
    connections,
    ready,

    waitFor(sandboxId, { timeoutMs = 30_000 } = {}) {
      const existing = connections.get(sandboxId);
      if (existing && existing.ws.readyState === existing.ws.OPEN) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const w = { sandboxId, resolve };
        w.timer = setTimeout(() => {
          waiters.delete(w);
          reject(new Error(`waitFor(${sandboxId}) timed out`));
        }, timeoutMs);
        waiters.add(w);
      });
    },

    get port() {
      return httpServer ? httpServer.address()?.port : undefined;
    },

    async close() {
      for (const w of [...waiters]) {
        clearTimeout(w.timer);
        waiters.delete(w);
        w.resolve(null);
      }
      for (const conn of connections.values()) conn.ws.close(1001);
      connections.clear();
      await new Promise((r) => wss.close(r));
      if (httpServer) await new Promise((r) => httpServer.close(r));
    },
  };
}

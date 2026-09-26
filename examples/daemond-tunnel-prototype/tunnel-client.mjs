// Tunnel client — the side daemond would embed.
//
// Uses Node 22's global WebSocket (no `ws` dependency — daemond ships zero deps).
// Node's global WebSocket cannot set custom headers, so the token is sent both
// as a `?token=` URL query param AND as a first `{"t":"auth","token"}` frame;
// the server accepts either.
//
// Usage as a script:
//   node tunnel-client.mjs <url> [token]
//   TUNNEL_TOKEN=... node tunnel-client.mjs <url>

import net from 'node:net';
import { encodeData, decodeData, MAX_FRAME_PAYLOAD } from './protocol.mjs';

const BACKPRESSURE_LIMIT = 1 * 1024 * 1024; // 1 MiB
const BACKOFF_MIN = 500;
const BACKOFF_MAX = 10_000;

function defaultAllowPorts(port) {
  return port > 0 && port < 65536;
}

function isAllowedHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function connectTunnel({
  url,
  token,
  allowPorts = defaultAllowPorts,
  maxStreams = 256,
  onStatus,
}) {
  const state = {
    closed: false,
    status: 'disconnected',
    ws: null,
    streams: new Map(), // id -> net.Socket
    backoff: BACKOFF_MIN,
    reconnectTimer: null,
  };

  function setStatus(s) {
    state.status = s;
    try { onStatus?.(s); } catch {}
  }

  function sendControl(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(obj));
    }
  }

  function sendError(id, code, message) {
    sendControl({ t: 'error', id, code, message });
  }

  function openStream(id, port, host) {
    if (state.streams.size >= maxStreams) {
      sendError(id, 'TOO_MANY_STREAMS', `max ${maxStreams} streams`);
      return;
    }
    if (!isAllowedHost(host) || !allowPorts(port)) {
      sendError(id, 'PORT_NOT_ALLOWED', `not allowed: ${host}:${port}`);
      return;
    }
    const sock = net.connect(port, host);
    state.streams.set(id, sock);
    sock.on('connect', () => {
      sendControl({ t: 'opened', id });
    });
    sock.on('data', (chunk) => {
      const ws = state.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      for (let off = 0; off < chunk.length; off += MAX_FRAME_PAYLOAD) {
        ws.send(encodeData(id, chunk.subarray(off, off + MAX_FRAME_PAYLOAD)));
      }
      if (ws.bufferedAmount > BACKPRESSURE_LIMIT) {
        sock.pause();
        const poll = setInterval(() => {
          if (ws.bufferedAmount <= BACKPRESSURE_LIMIT / 2 || ws.readyState !== WebSocket.OPEN) {
            clearInterval(poll);
            if (!sock.destroyed) sock.resume();
          }
        }, 20);
        poll.unref?.();
      }
    });
    sock.on('end', () => {
      sendControl({ t: 'close', id });
    });
    sock.on('error', (err) => {
      sendError(id, err.code || 'ESTREAM', err.message);
      state.streams.delete(id);
    });
    sock.on('close', () => {
      state.streams.delete(id);
    });
  }

  function handleMessage(data, isBinary) {
    if (isBinary) {
      const { id, payload } = decodeData(Buffer.from(data));
      const sock = state.streams.get(id);
      if (sock && !sock.destroyed) sock.write(payload);
      return;
    }
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString()); }
    catch { return; }
    switch (msg.t) {
      case 'open':
        openStream(msg.id, msg.port, msg.host || '127.0.0.1');
        break;
      case 'close': {
        const sock = state.streams.get(msg.id);
        if (sock) sock.end();
        break;
      }
      case 'ping':
        sendControl({ t: 'pong', ts: msg.ts });
        break;
      case 'opened':
      case 'error':
        // initiated-by-us streams: not used by this prototype client
        break;
    }
  }

  function connect() {
    if (state.closed) return;
    setStatus('connecting');
    const u = new URL(url);
    if (token) u.searchParams.set('token', token);
    const ws = new WebSocket(u.toString());
    state.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      if (token) ws.send(JSON.stringify({ t: 'auth', token }));
      state.backoff = BACKOFF_MIN;
      setStatus('connected');
    });
    ws.addEventListener('message', (ev) => {
      handleMessage(ev.data, typeof ev.data !== 'string');
    });
    ws.addEventListener('close', () => {
      for (const sock of state.streams.values()) sock.destroy();
      state.streams.clear();
      if (state.closed) { setStatus('closed'); return; }
      setStatus('disconnected');
      const jitter = Math.random() * 0.3 * state.backoff;
      const delay = Math.min(state.backoff + jitter, BACKOFF_MAX);
      state.backoff = Math.min(state.backoff * 2, BACKOFF_MAX);
      state.reconnectTimer = setTimeout(connect, delay);
      state.reconnectTimer.unref?.();
    });
    ws.addEventListener('error', () => {
      // 'close' follows; reconnect handled there
    });
  }

  connect();

  return {
    get status() { return state.status; },
    close() {
      state.closed = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      for (const sock of state.streams.values()) sock.destroy();
      state.streams.clear();
      const ws = state.ws;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      setStatus('closed');
    },
  };
}

// --- script mode ---
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const url = process.argv[2];
  const token = process.argv[3] || process.env.TUNNEL_TOKEN;
  if (!url) {
    console.error('usage: node tunnel-client.mjs <ws-url> [token]');
    process.exit(1);
  }
  connectTunnel({
    url,
    token,
    onStatus: (s) => console.log(`[tunnel-client] ${s}`),
  });
}

import type { Dispatcher } from 'undici';
import type { TLSSocket } from 'node:tls';

const MAX_ORIGINS = 16;
const IDLE_MS = 30_000;
const CONNECTIONS = 4;

interface Transport {
  dispatcher: Dispatcher;
  fetch(input: string, init: RequestInit): Promise<Response>;
  close(): void;
}

interface Entry {
  users: number;
  transport: Promise<Transport | undefined>;
  timer?: ReturnType<typeof setTimeout>;
}

export interface TransportLease {
  dispatcher?: Dispatcher;
  fetch?: Transport['fetch'];
  release(): void;
}

// Factories are short-lived in ComputeSDK bursts. Connections belong to the
// origin/process, not a factory, and credentials stay on individual requests.
const origins = new Map<string, Entry>();
const noTransport: TransportLease = { release() {} };

function forget(origin: string, entry: Entry): void {
  if (origins.get(origin) === entry) origins.delete(origin);
  clearTimeout(entry.timer);
  // A cancelled caller must not cancel negotiation for other callers. If an
  // unused negotiation is still finishing, close its result when it arrives.
  void entry.transport.then((transport) => transport?.close(), () => {});
}

function release(origin: string, entry: Entry): void {
  entry.users -= 1;
  if (entry.users !== 0 || origins.get(origin) !== entry) return;
  entry.timer = setTimeout(() => forget(origin, entry), IDLE_MS);
  (entry.timer as unknown as { unref?: () => void }).unref?.();
}

async function negotiate(origin: string): Promise<Transport | undefined> {
  let module: typeof import('undici');
  try {
    module = await import('undici');
  } catch (error) {
    // Optional on older/custom installations. No HTTP request was dispatched,
    // so native fetch is a safe fallback when the package is absent.
    const code = (error as { code?: string }).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
  const { Agent, buildConnector } = module;
  const url = new URL(origin);
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const connector = buildConnector({ allowH2: true, timeout: 10_000 });
  // Negotiate before dispatching any HTTP request. This lets HTTP/1.1 origins
  // keep native fetch's concurrency instead of being capped at four sockets.
  let firstSocket: TLSSocket | undefined = await new Promise<TLSSocket>((resolve, reject) => {
    connector({
      hostname,
      host: url.host,
      protocol: url.protocol,
      port: url.port || '443',
    }, (error, socket) => {
      if (error) reject(error);
      else resolve(socket as TLSSocket);
    });
  });
  if (firstSocket.alpnProtocol !== 'h2') {
    firstSocket.destroy();
    return undefined;
  }
  firstSocket.unref();
  // Reuse the negotiated socket: H2 does not pay for a throwaway probe and a
  // second handshake. Further connections use the same verified TLS settings.
  const agent = new Agent({
    allowH2: true,
    connections: CONNECTIONS,
    h2Options: { maxConcurrentStreams: 100 },
    connect(options, callback) {
      if (firstSocket && options.hostname === hostname
        && String(options.port || '443') === (url.port || '443')) {
        const socket = firstSocket;
        firstSocket = undefined;
        queueMicrotask(() => callback(null, socket));
      } else {
        connector(options, callback);
      }
    },
  });
  return {
    dispatcher: agent,
    // Undici 8's dispatch handler interface differs from Node's bundled
    // fetch. Use the matching fetch implementation rather than attaching an
    // incompatible dispatcher to the global fetch implementation.
    fetch: (input, init) => module.fetch(input, {
      ...init,
      dispatcher: agent,
    } as unknown as Parameters<typeof module.fetch>[1]) as unknown as Promise<Response>,
    close() {
      firstSocket?.destroy();
      void agent.close().catch(() => agent.destroy());
    },
  };
}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

export async function acquireTransport(
  input: string,
  enabled: boolean,
  signal: AbortSignal,
): Promise<TransportLease> {
  // Keep non-Node, older Node and cleartext/custom development endpoints on
  // native fetch. Loading Undici is lazy and cannot affect other providers.
  const version = typeof process === 'undefined' ? undefined : process.versions?.node;
  const [major, minor] = version?.split('.').map(Number) ?? [];
  if (!enabled || !major || major < 22 || (major === 22 && minor < 19)) return noTransport;
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password) return noTransport;
  signal.throwIfAborted();

  const origin = url.origin;
  let entry = origins.get(origin);
  if (!entry) {
    if (origins.size >= MAX_ORIGINS) {
      const idle = [...origins].find(([, candidate]) => candidate.users === 0);
      if (idle) forget(...idle);
      else return noTransport;
    }
    entry = { users: 0, transport: negotiate(origin) };
    origins.set(origin, entry);
  }
  const current = entry;
  clearTimeout(current.timer);
  current.users += 1;
  try {
    const transport = await withSignal(current.transport, signal);
    let released = false;
    return {
      dispatcher: transport?.dispatcher,
      fetch: transport?.fetch,
      release() {
        if (released) return;
        released = true;
        release(origin, current);
      },
    };
  } catch (error) {
    release(origin, current);
    // Failed connection negotiation is not an HTTP/1.1 fallback or a reason
    // to retry a POST. A future independent request may negotiate anew.
    if (!signal.aborted) forget(origin, current);
    throw error;
  }
}

import * as http2 from "node:http2";

import { afterEach, describe, expect, it, vi } from "vitest";

import { closeMiosaConnections, nodeHttp2Request } from "../index";

// These tests exercise the real node:http2 transport against a local plaintext
// HTTP/2 server, the same method used to gather the live A/B evidence this
// change responds to. The rest of the suite stubs `fetch` and never takes this
// path (nodeHttp2Request is disabled under NODE_ENV=test by canUseNodeHttp2;
// these tests call it directly, bypassing that guard).

interface TestServer {
  origin: string;
  streamsSeen: number;
  sessionsSeen: Set<http2.Http2Session>;
  streamsPerSession: Map<http2.Http2Session, number>;
  close: () => Promise<void>;
}

function startServer(
  maxConcurrentStreams: number,
  responseDelayMs = 5,
): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const sessionsSeen = new Set<http2.Http2Session>();
    const streamsPerSession = new Map<http2.Http2Session, number>();
    let streamsSeen = 0;
    const server = http2.createServer({
      settings: { maxConcurrentStreams },
    });
    server.on("session", (session) => sessionsSeen.add(session));
    server.on("stream", (stream) => {
      streamsSeen += 1;
      streamsPerSession.set(
        stream.session as http2.Http2Session,
        (streamsPerSession.get(stream.session as http2.Http2Session) ?? 0) + 1,
      );
      setTimeout(() => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      }, responseDelayMs);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected an AddressInfo"));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        get streamsSeen() {
          return streamsSeen;
        },
        sessionsSeen,
        streamsPerSession,
        close: () =>
          new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

async function burst(
  origin: string,
  count: number,
): Promise<Array<{ ok: boolean; status: number }>> {
  const requests = Array.from({ length: count }, () =>
    nodeHttp2Request(new URL(`${origin}/`), "GET", {}),
  );
  const settled = await Promise.allSettled(requests);
  return settled.map((result) =>
    result.status === "fulfilled"
      ? { ok: result.value.ok, status: result.value.status }
      : { ok: false, status: 0 },
  );
}

describe("http2 pool dispatch", () => {
  afterEach(() => {
    closeMiosaConnections();
  });

  it("should spread a burst across sessions rather than serialize it on one", async () => {
    const server = await startServer(250);
    try {
      const results = await burst(server.origin, 40);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(server.sessionsSeen.size).toBeGreaterThan(1);
    } finally {
      await server.close();
    }
  });

  it("should respect a low per-session stream cap once it is known", async () => {
    // A single warm-up request gives every session time to connect and
    // exchange real SETTINGS (remoteSettings is Node's own placeholder of
    // 100 until then, same as the quorum design this replaces - that cold
    // race is pre-existing and not what this change claims to fix). Once the
    // real cap (2) is known, the burst below must stay within it per
    // session: dispatch has to read each session's own advertised limit, not
    // assume every ready session has the same room.
    const server = await startServer(2);
    try {
      await burst(server.origin, 1);
      server.streamsPerSession.clear();
      // 6 requests at 2 streams each fit inside the 4-session pool, so nothing
      // has to fall back onto a saturated session and the cap must hold.
      const results = await burst(server.origin, 6);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(server.streamsSeen).toBe(7);
      expect(server.sessionsSeen.size).toBe(4);
      expect(
        Math.max(...server.streamsPerSession.values()),
      ).toBeLessThanOrEqual(2);
    } finally {
      await server.close();
    }
  });

  it("should reuse a warm session for a second burst without reconnecting", async () => {
    const server = await startServer(250);
    try {
      await burst(server.origin, 10);
      const sessionsAfterFirst = server.sessionsSeen.size;
      await burst(server.origin, 10);
      expect(server.sessionsSeen.size).toBe(sessionsAfterFirst);
    } finally {
      await server.close();
    }
  });

  it("should not stall a request behind other sessions once one session is ready", async () => {
    const server = await startServer(250, 30);
    try {
      const start = Date.now();
      await burst(server.origin, 1);
      // A cold client waits for its pool, but the wait is bounded and short:
      // loopback connect plus the server's own 30 ms response delay, well under
      // the old design's 250 ms quorum-polling ceiling.
      expect(Date.now() - start).toBeLessThan(150);
    } finally {
      await server.close();
    }
  });

  it("should spread a synchronous burst across many sessions", async () => {
    // 100 requests fired in a single turn: each must see the load the
    // previous one reserved, so no session takes the whole burst.
    const server = await startServer(250, 30);
    try {
      // Warm the pool so all 16 sessions are ready; at cold start only the
      // first connected session is eligible, which is by design.
      await burst(server.origin, 1);
      while (server.sessionsSeen.size < 4) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      server.streamsPerSession.clear();
      const results = await burst(server.origin, 100);
      expect(results.every((r) => r.ok)).toBe(true);
      const counts = [...server.streamsPerSession.values()];
      expect(counts.length).toBe(4);
      // 100 requests over 4 sessions: no session may take the whole burst.
      expect(Math.max(...counts)).toBeLessThanOrEqual(40);
    } finally {
      await server.close();
    }
  });

  it("should spread a cold burst across the whole pool instead of piling it on one session", async () => {
    // A fresh client has nothing connected. If the burst dispatches as soon as
    // the first session is ready, every request reserves its slot in the same
    // turn, before any other session has connected, so all 100 land on that one
    // session. Waiting for the pool, bounded, is what makes the burst spread.
    const server = await startServer(250, 20);
    try {
      const results = await burst(server.origin, 100);

      expect(results.every((r) => r.ok)).toBe(true);
      const counts = [...server.streamsPerSession.values()];
      expect(counts.length).toBe(4);
      expect(Math.max(...counts)).toBeLessThanOrEqual(40);
    } finally {
      await server.close();
    }
  });

  it("should clamp an unusable connect bound instead of disarming itself", async () => {
    // Node clamps a timer delay above 2^31-1 to about a millisecond, which
    // would destroy every session as it connects rather than bounding the
    // wait, so the parser must never hand such a value to setTimeout.
    const previous = process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS;
    process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS = "2592000000";
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      handler: () => void,
      delay?: number,
      ...rest: unknown[]
    ) => {
      if (typeof delay === "number") delays.push(delay);
      return realSetTimeout(
        handler as never,
        delay as never,
        ...(rest as never[]),
      );
    }) as never);
    try {
      const server = await startServer(250);
      try {
        const results = await burst(server.origin, 1);
        expect(results.every((r) => r.ok)).toBe(true);
      } finally {
        await server.close();
      }
      expect(Math.max(...delays)).toBeLessThanOrEqual(2_147_483_647);
    } finally {
      spy.mockRestore();
      if (previous === undefined) {
        delete process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS;
      } else {
        process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS = previous;
      }
    }
  });

  it("should reject when a connect never completes instead of waiting on the OS", async () => {
    // A blackholed route drops the SYN silently: the socket neither connects
    // nor errors, and `http2.connect(origin, { timeout })` does not cover it.
    // Unbounded, the session keeps its pool slot and the request waits out the
    // OS connect timeout (over a minute) instead of failing fast.
    const previous = process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS;
    process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS = "250";
    try {
      const start = Date.now();
      await expect(
        nodeHttp2Request(new URL("https://10.255.255.1:443/"), "GET", {}),
      ).rejects.toThrow();
      // The bound is what matters, not which error arrives: the connect timer
      // when the route blackholes, or the OS when it reports unreachable.
      expect(Date.now() - start).toBeLessThan(5_000);
      expect(
        process.getActiveResourcesInfo().filter((r) => r === "Timeout"),
      ).toHaveLength(0);
    } finally {
      if (previous === undefined) {
        delete process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS;
      } else {
        process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS = previous;
      }
    }
  });

  it("should reject promptly when every connection is refused", async () => {
    const server = await startServer(250);
    const origin = server.origin;
    await server.close();
    const timersBefore = process
      .getActiveResourcesInfo()
      .filter((r) => r === "Timeout").length;
    const start = Date.now();
    await expect(
      nodeHttp2Request(new URL(`${origin}/`), "GET", {}),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(Date.now() - start).toBeLessThan(900);
    expect(
      process.getActiveResourcesInfo().filter((r) => r === "Timeout"),
    ).toHaveLength(timersBefore);
  });
});

import * as http2 from "node:http2";

import { afterEach, describe, expect, it } from "vitest";

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
  close: () => Promise<void>;
}

function startServer(
  maxConcurrentStreams: number,
  responseDelayMs = 5,
): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const sessionsSeen = new Set<http2.Http2Session>();
    let streamsSeen = 0;
    const server = http2.createServer({
      settings: { maxConcurrentStreams },
    });
    server.on("session", (session) => sessionsSeen.add(session));
    server.on("stream", (stream) => {
      streamsSeen += 1;
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
      const results = await burst(server.origin, 20);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(server.streamsSeen).toBe(21);
      // 20 requests capped at 2 per session need at least 10 sessions.
      expect(server.sessionsSeen.size).toBeGreaterThanOrEqual(10);
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
      // No quorum of sessions is required before the first request can be
      // dispatched: one ready session with room is enough, so this clears
      // well under the old design's 250 ms quorum-polling ceiling - loopback
      // connect plus the server's own 30 ms response delay, not 250 ms+ of
      // polling on top of it.
      expect(Date.now() - start).toBeLessThan(150);
    } finally {
      await server.close();
    }
  });
});

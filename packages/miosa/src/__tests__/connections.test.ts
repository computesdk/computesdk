import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeHttp2Session extends EventEmitter {
  closed = false;
  destroyed = false;
  ref = vi.fn();
  unref = vi.fn();

  close(): void {
    this.closed = true;
    this.emit("close");
  }
}

describe("MIOSA connection preparation", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock("node:http2");
    vi.resetModules();
  });

  it("waits for the HTTP/2 readiness quorum", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const sessions: FakeHttp2Session[] = [];
    const connect = vi.fn(() => {
      const session = new FakeHttp2Session();
      sessions.push(session);
      return session;
    });
    vi.doMock("node:http2", () => ({ connect }));

    const { closeMiosaConnections, prepareMiosaConnections } =
      await import("../index");
    let prepared = false;
    const preparation = prepareMiosaConnections({
      apiKey: "msk_test_0123456789abcdef",
    }).then((result) => {
      prepared = true;
      return result;
    });

    await vi.waitFor(() => expect(sessions).toHaveLength(16));
    for (const session of sessions.slice(0, 7)) {
      session.emit("remoteSettings");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(prepared).toBe(false);

    sessions[7]?.emit("remoteSettings");
    expect(await preparation).toEqual({
      ready: 8,
      requested: 8,
      established: true,
    });
    expect(prepared).toBe(true);

    closeMiosaConnections();
  });

  it("resolves best-effort when no handshake completes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers();
    try {
      const sessions: FakeHttp2Session[] = [];
      const connect = vi.fn(() => {
        const session = new FakeHttp2Session();
        sessions.push(session);
        return session;
      });
      vi.doMock("node:http2", () => ({ connect }));

      const { closeMiosaConnections, prepareMiosaConnections } =
        await import("../index");
      const preparation = prepareMiosaConnections({
        apiKey: "msk_test_0123456789abcdef",
      });

      await vi.waitFor(() => expect(sessions).toHaveLength(16));
      await vi.advanceTimersByTimeAsync(5_000);

      expect(await preparation).toEqual({
        ready: 0,
        requested: 8,
        established: false,
      });

      closeMiosaConnections();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arms readiness after every session drains", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const sessions: FakeHttp2Session[] = [];
    const connect = vi.fn(() => {
      const session = new FakeHttp2Session();
      sessions.push(session);
      return session;
    });
    vi.doMock("node:http2", () => ({ connect }));

    const { closeMiosaConnections, prepareMiosaConnections } =
      await import("../index");
    const config = { apiKey: "msk_test_0123456789abcdef" };

    const first = prepareMiosaConnections(config);
    await vi.waitFor(() => expect(sessions).toHaveLength(16));
    for (const session of sessions.slice(0, 8)) session.emit("remoteSettings");
    expect((await first).established).toBe(true);

    // Every session goes away, as a goaway/close storm would do.
    for (const session of [...sessions]) session.close();
    sessions.length = 0;

    let secondSettled = false;
    const second = prepareMiosaConnections(config).then((result) => {
      secondSettled = true;
      return result;
    });

    await vi.waitFor(() => expect(sessions).toHaveLength(16));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondSettled).toBe(false);

    for (const session of sessions.slice(0, 8)) session.emit("remoteSettings");
    expect(await second).toEqual({
      ready: 8,
      requested: 8,
      established: true,
    });

    closeMiosaConnections();
  });

  it("rejects invalid credentials before opening connections", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const connect = vi.fn();
    vi.doMock("node:http2", () => ({ connect }));

    const { prepareMiosaConnections } = await import("../index");

    await expect(
      prepareMiosaConnections({ apiKey: "not-a-miosa-key" }),
    ).rejects.toThrow(/start with 'msk_'/);
    expect(connect).not.toHaveBeenCalled();
  });
});

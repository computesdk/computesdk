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

    const { closeMiosaConnections, prepareMiosaConnections } = await import(
      "../index"
    );
    let prepared = false;
    const preparation = prepareMiosaConnections({
      apiKey: "msk_test_0123456789abcdef",
    }).then(() => {
      prepared = true;
    });

    await vi.waitFor(() => expect(sessions).toHaveLength(16));
    for (const session of sessions.slice(0, 7)) {
      session.emit("remoteSettings");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(prepared).toBe(false);

    sessions[7]?.emit("remoteSettings");
    await preparation;
    expect(prepared).toBe(true);

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

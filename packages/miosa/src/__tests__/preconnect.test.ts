import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as net from "node:net";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import-time behaviour can only be observed on a freshly evaluated module, so
// every case clears the module registry and imports again under its own
// environment. A plain TCP server stands in for the endpoint: it records that
// the pool opened, and the TLS handshake failing against it afterwards is
// beside the point.
async function importFresh(): Promise<typeof import("../index")> {
  vi.resetModules();
  return import("../index");
}

interface CountingServer {
  url: string;
  connections: () => number;
  open: () => number;
  close: () => Promise<void>;
}

function countingServer(): Promise<CountingServer> {
  return new Promise((resolve) => {
    let connections = 0;
    let open = 0;
    const server = net.createServer((socket) => {
      connections += 1;
      open += 1;
      socket.on("close", () => {
        open -= 1;
      });
      socket.on("error", () => {});
      socket.on("data", () => {});
    });
    server.on("error", () => {});
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected an AddressInfo");
      }
      resolve({
        url: `https://127.0.0.1:${address.port}/api/v1`,
        connections: () => connections,
        open: () => open,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("preconnect on import", () => {
  let server: CountingServer;
  let loaded: typeof import("../index") | undefined;

  beforeEach(async () => {
    server = await countingServer();
    // canUseNodeHttp2 only takes the pooled transport outside a test run, and
    // these cases are about what the module does to that transport.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MIOSA_BASE_URL", server.url);
  });

  afterEach(async () => {
    loaded?.closeMiosaConnections();
    loaded = undefined;
    vi.unstubAllEnvs();
    await server.close();
  });

  it("should open the pool for MIOSA_BASE_URL when the module is imported with a usable key", async () => {
    vi.stubEnv("MIOSA_API_KEY", "msk_0123456789abcdefghijklmnop");

    loaded = await importFresh();
    await settle(300);

    expect(server.connections()).toBeGreaterThan(0);
  });

  it("should open nothing when no key is present", async () => {
    vi.stubEnv("MIOSA_API_KEY", "");

    loaded = await importFresh();
    await settle(300);

    expect(server.connections()).toBe(0);
  });

  it("should open nothing when the key is malformed", async () => {
    vi.stubEnv("MIOSA_API_KEY", "not-a-miosa-key");

    loaded = await importFresh();
    await settle(300);

    expect(server.connections()).toBe(0);
  });

  it("should open nothing when MIOSA_PRECONNECT opts out", async () => {
    vi.stubEnv("MIOSA_API_KEY", "msk_0123456789abcdefghijklmnop");
    vi.stubEnv("MIOSA_PRECONNECT", "0");

    loaded = await importFresh();
    await settle(300);

    expect(server.connections()).toBe(0);
  });

  it("should open nothing when closed immediately after import", async () => {
    vi.stubEnv("MIOSA_API_KEY", "msk_0123456789abcdefghijklmnop");

    loaded = await importFresh();
    loaded.closeMiosaConnections();
    await settle(300);

    expect(server.connections()).toBe(0);
  });

  it("should close a pool nothing used after the idle timeout", async () => {
    vi.stubEnv("MIOSA_API_KEY", "msk_0123456789abcdefghijklmnop");
    vi.stubEnv("MIOSA_PRECONNECT_IDLE_MS", "400");
    vi.stubEnv("MIOSA_HTTP2_CONNECT_TIMEOUT_MS", "10000");

    loaded = await importFresh();
    await settle(150);
    expect(server.open()).toBeGreaterThan(0);

    await settle(700);
    expect(server.open()).toBe(0);
  });

  it("should close an unused import-time pool when closeMiosaConnections is called", async () => {
    vi.stubEnv("MIOSA_API_KEY", "msk_0123456789abcdefghijklmnop");
    vi.stubEnv("MIOSA_HTTP2_CONNECT_TIMEOUT_MS", "10000");

    loaded = await importFresh();
    await settle(150);
    expect(server.open()).toBeGreaterThan(0);

    loaded.closeMiosaConnections();
    await settle(200);
    expect(server.open()).toBe(0);
  });

  it("should not hold the process open", () => {
    // Whether a script still exits can only be seen from outside the process.
    // getActiveResourcesInfo is not the instrument: an unref'd pool socket is
    // still listed there, so it over-reports. A child that imports the built
    // package and then simply returns is the direct measurement. The build
    // step the repository runs before its tests produces that artifact.
    // Vitest runs with the package as its working directory.
    const dist = resolve(process.cwd(), "dist", "index.mjs");
    expect(
      existsSync(dist),
      `build the package first: ${dist} is missing`,
    ).toBe(true);

    const script = `
      import net from "node:net";
      const server = net.createServer((socket) => {
        socket.on("error", () => {});
        socket.on("data", () => {});
      });
      server.listen(0, "127.0.0.1", async () => {
        server.unref();
        process.env.MIOSA_API_KEY = "msk_0123456789abcdefghijklmnop";
        process.env.MIOSA_BASE_URL =
          "https://127.0.0.1:" + server.address().port + "/api/v1";
        await import(${JSON.stringify(dist)});
      });
    `;
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        timeout: 15_000,
        encoding: "utf8",
        // A peer that accepts the connection and then never completes the
        // handshake is the worst case for an idle pool, so give the connect
        // phase a short bound and check the script still leaves on its own
        // rather than waiting the bound out.
        env: { ...process.env, MIOSA_HTTP2_CONNECT_TIMEOUT_MS: "1500" },
      },
    );

    // A pool that held the loop would be killed by the timeout instead of
    // exiting, which shows up as a signal with no status.
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

/**
 * Live test for the CreateOS snapshot lifecycle the conformance suite can't
 * reach: snapshot.create (paused fork), restore via create({ snapshotId })
 * after the source is gone, parallel restores, isolation from post-snapshot
 * mutations, snapshot.list / delete, and the getInstance() escape hatch.
 *
 * Gated on CREATEOS_SANDBOX_API_KEY — skipped entirely without creds.
 *
 *   CREATEOS_SANDBOX_API_KEY=skp_... npx vitest run src/__tests__/snapshot.integration.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";
import { createosSandbox } from "../index.js";

const live = !!process.env.CREATEOS_SANDBOX_API_KEY && process.env.SKIP_INTEGRATION !== "true";
const provider = createosSandbox({});

describe.skipIf(!live)("createos snapshot / restore (live)", () => {
  const sandboxIds: string[] = [];
  let snapshotId: string | undefined;

  afterAll(async () => {
    for (const id of sandboxIds) await provider.sandbox.destroy(id).catch(() => undefined);
    if (snapshotId) await provider.snapshot!.delete(snapshotId).catch(() => undefined);
  }, 120_000);

  it("snapshots a running box, keeps the source running, restores after the source is destroyed", async () => {
    const source = await provider.sandbox.create({});
    sandboxIds.push(source.sandboxId);
    const marker = `snap-marker-${Date.now()}.txt`;
    await source.filesystem.writeFile(marker, "before-snapshot");

    const snap = await provider.snapshot!.create(source.sandboxId, { name: "computesdk-live" });
    snapshotId = snap.id;
    expect(snap.id).toMatch(/^sb-/);
    expect(snap.id).not.toBe(source.sandboxId);

    // The source is back up and accepts work; mutations after the snapshot
    // must not leak into restores.
    expect((await source.getInfo()).status).toBe("running");
    await source.filesystem.writeFile(marker, "after-snapshot");
    expect(await source.filesystem.readFile(marker)).toBe("after-snapshot");

    expect((await provider.snapshot!.list()).map((s: { id: string }) => s.id)).toContain(snap.id);

    await source.destroy();

    // Fan out: several restores from the one snapshot, in parallel.
    const restored = await Promise.all(
      [0, 1, 2].map(() =>
        provider.sandbox.create({ snapshotId: snap.id } as Record<string, unknown>),
      ),
    );
    for (const r of restored) sandboxIds.push(r.sandboxId);
    expect(new Set(restored.map((r) => r.sandboxId)).size).toBe(3);
    for (const r of restored) {
      expect(r.sandboxId).not.toBe(snap.id);
      expect(await r.filesystem.readFile(marker)).toBe("before-snapshot");
      const echo = await r.runCommand("echo restored-alive");
      expect(echo.exitCode).toBe(0);
      expect(echo.stdout).toContain("restored-alive");
    }

    await provider.snapshot!.delete(snap.id);
    snapshotId = undefined;
  }, 480_000);

  it("native pause / resume keeps the same box once the pause settles", async () => {
    const box = await provider.sandbox.create({});
    sandboxIds.push(box.sandboxId);
    await box.runCommand("echo kept > pause-marker.txt");
    const native = box.getInstance() as {
      pause: () => Promise<unknown>;
      waitUntilPaused: (o?: object) => Promise<unknown>;
      resume: () => Promise<unknown>;
      waitUntilRunning: (o?: object) => Promise<unknown>;
    };
    await native.pause();
    await native.waitUntilPaused({ timeoutMs: 120_000 });
    expect((await box.getInfo()).metadata?.createosStatus).toBe("paused");
    await native.resume();
    await native.waitUntilRunning({ timeoutMs: 120_000 });
    const r = await box.runCommand("cat pause-marker.txt");
    expect(r.stdout.trim()).toBe("kept");
  }, 300_000);
});

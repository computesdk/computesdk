/**
 * Live smoke test for the CreateOS headline behaviour the conformance suite
 * can't reach: snapshot.create (= pause), snapshot.list, and fork via
 * create({ snapshotId }). Plus the getInstance() escape hatch.
 *
 * Gated on CREATEOS_SANDBOX_API_KEY — skipped entirely without creds.
 *
 *   CREATEOS_SANDBOX_API_KEY=skp_... CREATEOS_SANDBOX_BASE_URL=https://createos-sandbox.example.com \
 *     npx vitest run src/__tests__/snapshot.integration.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";
import { createosSandbox } from "../index.js";

const live = !!process.env.CREATEOS_SANDBOX_API_KEY && process.env.SKIP_INTEGRATION !== "true";
const provider = createosSandbox({});

describe.skipIf(!live)("createos snapshot / fork (live)", () => {
  let sourceId: string | undefined;
  let cloneId: string | undefined;

  afterAll(async () => {
    if (cloneId) await provider.sandbox.destroy(cloneId).catch(() => undefined);
    if (sourceId) await provider.sandbox.destroy(sourceId).catch(() => undefined);
  }, 60_000);

  it("pauses via snapshot.create, lists the snapshot, forks a running clone", async () => {
    // 1. running source
    const source = await provider.sandbox.create({});
    sourceId = source.sandboxId;
    expect(sourceId).toMatch(/^sb-/);
    expect((await source.getInfo()).status).toBe("running");

    // 2. snapshot.create => pause; the paused sandbox id IS the snapshot id
    const snap = await provider.snapshot!.create(sourceId);
    expect(snap.id).toBe(sourceId);

    // ensure the pause has settled before forking
    const srcHandle = await provider.sandbox.getById(sourceId);
    expect(srcHandle).not.toBeNull();
    // getInstance() = native @nodeops-createos/sandbox handle (the escape hatch)
    await (
      srcHandle!.getInstance() as { waitUntilPaused: (o: object) => Promise<unknown> }
    ).waitUntilPaused({ timeoutMs: 120_000 });
    const info = await srcHandle!.getInfo();
    expect(info.status).toBe("stopped"); // paused -> stopped
    expect((info.metadata as Record<string, unknown>).createosStatus).toBe("paused");

    // 3. snapshot.list includes the paused id
    const snaps = await provider.snapshot!.list();
    expect(snaps.map((s: { id: string }) => s.id)).toContain(sourceId);

    // 4. fork: create({ snapshotId }) clones the paused bundle into a new VM
    const clone = await provider.sandbox.create({ snapshotId: sourceId } as Record<
      string,
      unknown
    >);
    cloneId = clone.sandboxId;
    expect(cloneId).toMatch(/^sb-/);
    expect(cloneId).not.toBe(sourceId);

    // 5. the forked clone is alive and independent
    const r = await clone.runCommand("echo forked-alive");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("forked-alive");
  }, 240_000);
});

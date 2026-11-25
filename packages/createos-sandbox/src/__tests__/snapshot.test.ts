import { afterEach, expect, it, vi } from "vitest";
import { CreateosSandboxClient, SnapshotsApi, type Sandbox, type SnapshotView } from "@nodeops-createos/sandbox";
import { createosSandbox } from "../index.js";

const manager = createosSandbox({ apiKey: "test", baseUrl: "https://createos.test" }).snapshot!;
const snapshot = {
  id: "snap_1", sandbox_id: "sb-source", type: "full", status: "creating",
  created_at: "2026-01-01T00:00:00Z", shape: "small", vcpu: 1, mem_mib: 1024, disk_mib: 10240, size_bytes: 0,
} satisfies SnapshotView;

afterEach(() => {
  vi.restoreAllMocks();
});

it("lists only ready native artifacts for the requested source", async () => {
  vi.spyOn(SnapshotsApi.prototype, "list").mockResolvedValue([
    snapshot, { ...snapshot, status: "failed" }, { ...snapshot, status: "deleting" },
    { ...snapshot, id: "other", status: "ready", sandbox_id: "sb-other" },
    { ...snapshot, id: "ready", status: "ready" },
  ]);
  vi.spyOn(CreateosSandboxClient.prototype, "listSandboxes").mockResolvedValue([]);
  expect((await manager.list({ instanceId: "sb-source", limit: 1 })).map(s => s.id)).toEqual(["ready"]);
});

it("forks an already paused source without resuming it", async () => {
  const waitUntilPaused = vi.fn().mockResolvedValue(undefined);
  const fork = vi.fn().mockResolvedValue({ id: "sb-copy", waitUntilPaused, data: { created_at: snapshot.created_at } });
  vi.spyOn(CreateosSandboxClient.prototype, "getSandbox").mockResolvedValue({ status: "paused", fork } as unknown as Sandbox);
  expect(await manager.create("sb-source")).toMatchObject({ id: "sb-copy", metadata: { sourceSandboxId: "sb-source" } });
  expect(fork).toHaveBeenCalledWith({ start_paused: true });
  expect(waitUntilPaused).toHaveBeenCalledOnce();
});

it("reports the artifact id and both errors when readiness and cleanup fail", async () => {
  const pollError = new Error("timed out");
  const cleanupError = new Error("snapshot still creating");
  const createSnapshot = vi.fn().mockResolvedValue(snapshot);
  vi.spyOn(CreateosSandboxClient.prototype, "getSandbox").mockResolvedValue({ status: "running", createSnapshot } as unknown as Sandbox);
  vi.spyOn(SnapshotsApi.prototype, "get").mockRejectedValue(pollError);
  const remove = vi.spyOn(SnapshotsApi.prototype, "delete").mockRejectedValue(cleanupError);
  await expect(manager.create("sb-source")).rejects.toMatchObject({
    message: expect.stringContaining("snap_1 did not become ready and cleanup failed"),
    errors: [pollError, cleanupError],
  });
  expect(remove).toHaveBeenCalledWith("snap_1");
});

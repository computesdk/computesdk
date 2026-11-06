import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { closeMiosaConnections, miosa } from "../index";

it("traces snapshot readiness, restore, and verified cleanup within 300s", async () => {
  expect(process.env.MIOSA_API_KEY).toBeTruthy();
  const started = Date.now();
  const tag = `miosa-diagnostic-${randomUUID()}`;
  const baseUrl = (process.env.MIOSA_BASE_URL ?? "https://api.miosa.ai/api/v1").replace(/\/+$/, "");
  const nativeFetch = globalThis.fetch;
  const owned = new Set<string>();
  const snapshots = new Map<string, string>();
  let phase = "workload";
  let deadline = started + 230_000;
  const emit = (event: string, fields: Record<string, unknown> = {}) =>
    console.log("MIOSA_SNAPSHOT_TRACE", JSON.stringify({ event, elapsedMs: Date.now() - started, phase, tag, ...fields }));
  const fields = (record: any) => ({ id: record?.id, state: record?.state, status: record?.status, ready: record?.ready, createdAt: record?.created_at });

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    const begin = Date.now();
    const remaining = deadline - begin;
    if (remaining <= 0) throw new Error(`Diagnostic ${phase} deadline exhausted`);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    emit("http-start", { method, path, request: body ? {
      wait: body.wait, persistent: body.persistent, timeoutSec: body.timeout_sec,
      runtimeProfile: body.runtime_profile, snapshotId: body.snapshot_id,
      waitTimeoutMs: body.wait_timeout_ms,
    } : undefined });
    try {
      const signal = init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(remaining)])
        : AbortSignal.timeout(remaining);
      const response = await nativeFetch(input, { ...init, signal });
      const payload = await response.clone().json().catch(() => undefined);
      const record = payload?.data ?? payload;
      if (response.ok && method === "POST" && path.endsWith("/sandboxes") && record?.id) owned.add(record.id);
      const owner = path.match(/\/sandboxes\/([^/]+)\/snapshots$/)?.[1];
      if (response.ok && method === "POST" && owner && record?.id) snapshots.set(record.id, owner);
      emit("http-end", { method, path, httpStatus: response.status, durationMs: Date.now() - begin,
        record: Array.isArray(record) ? undefined : fields(record),
        snapshots: owner && Array.isArray(record) ? record.map(fields) : undefined,
        errorCode: payload?.error?.code ?? payload?.code,
        serverTiming: response.headers.get("server-timing"),
      });
      return response;
    } catch (error) {
      emit("http-error", { method, path, durationMs: Date.now() - begin, error: String(error) });
      throw error;
    }
  };

  const api = async (method: string, path: string) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: {
      authorization: `Bearer ${process.env.MIOSA_API_KEY}`, "content-type": "application/json",
    } });
    const payload: any = await response.json().catch(() => undefined);
    return { response, record: payload?.data ?? payload };
  };
  const timed = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const begin = Date.now();
    emit("stage-start", { name });
    try {
      const result = await run();
      emit("stage-end", { name, durationMs: Date.now() - begin });
      return result;
    } catch (error) {
      emit("stage-error", { name, durationMs: Date.now() - begin, error: String(error) });
      throw error;
    }
  };
  let workloadError: unknown;
  const cleanupErrors: string[] = [];
  try {
    emit("bounds", { workloadBudgetMs: 230_000, totalBudgetMs: 290_000, testTimeoutMs: 300_000 });
    const existing = await api("GET", "/sandboxes");
    emit("preexisting", { recent: Array.isArray(existing.record) ? existing.record.filter((r: any) =>
      r.created_at >= "2026-11-06T19:01:45" && r.created_at <= "2026-11-06T19:07:30").map(fields) : [] });
    const provider = miosa({});
    const source = await timed("source-create", () => provider.sandbox.create({ runtime: "firecracker", metadata: { diagnostic: tag } }));
    const pwd = await timed("source-pwd", () => source.runCommand('pwd; echo "$HOME"'));
    expect(pwd.exitCode).toBe(0);
    const marker = `${pwd.stdout.split("\n").map((s) => s.trim()).find(Boolean) ?? "/tmp"}/csdk-snapshot-${Date.now()}`;
    emit("marker", { sourceId: source.instanceId, marker });
    expect((await timed("source-write", () => source.runCommand(`echo snapshot-state > ${marker}`))).exitCode).toBe(0);
    const snapshot = await timed("snapshot-create-and-ready", () => provider.snapshot!.create(source.instanceId));
    emit("snapshot-returned", { sourceId: source.instanceId, snapshotId: snapshot.id, status: snapshot.status });
    expect((await timed("source-alive", () => source.runCommand("echo alive"))).stdout.trim()).toBe("alive");
    const restored = await timed("restore-create", () => provider.sandbox.create({ snapshotId: snapshot.id, metadata: { diagnostic: tag } }));
    expect(restored.instanceId).not.toBe(source.instanceId);
    const read = await timed("restore-read", () => restored.runCommand(`cat ${marker}`));
    expect(read.exitCode).toBe(0);
    expect(read.stdout.trim()).toBe("snapshot-state");
    emit("workload-passed", { sourceId: source.instanceId, restoredId: restored.instanceId, snapshotId: snapshot.id });
  } catch (error) {
    workloadError = error;
    emit("workload-failed", { error: String(error) });
  } finally {
    phase = "cleanup";
    deadline = started + 290_000;
    try {
      const inventory = await api("GET", "/sandboxes");
      for (const r of Array.isArray(inventory.record) ? inventory.record : []) {
        if (r.metadata?.diagnostic === tag) owned.add(r.id);
      }
      for (const id of owned) {
        const found = await api("GET", `/sandboxes/${id}/snapshots`);
        for (const snap of Array.isArray(found.record) ? found.record : []) snapshots.set(snap.id, id);
      }
    } catch (error) { cleanupErrors.push(`inventory: ${String(error)}`); }
    const sources = new Set(snapshots.values());
    const remove = async (path: string) => {
      for (;;) {
        const deleted = await api("DELETE", path);
        if (deleted.response.ok || deleted.response.status === 404) return;
        if (deleted.response.status !== 409 || Date.now() + 2_000 >= deadline) throw new Error(`Cleanup ${path}: HTTP ${deleted.response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    };
    for (const id of [...owned].filter((id) => !sources.has(id))) {
      try { await timed(`delete-child:${id}`, () => remove(`/sandboxes/${id}`)); }
      catch (error) { cleanupErrors.push(String(error)); }
    }
    for (const [id, owner] of snapshots) {
      try {
        await timed(`delete-snapshot:${id}`, () => remove(`/sandboxes/${owner}/snapshots/${id}`));
        const listed = await api("GET", `/sandboxes/${owner}/snapshots`);
        expect(listed.response.ok).toBe(true);
        expect((Array.isArray(listed.record) ? listed.record : []).filter((r: any) => r.id === id && r.status !== "deleted")).toHaveLength(0);
        emit("snapshot-cleanup-verified", { id, owner });
      } catch (error) { cleanupErrors.push(String(error)); }
    }
    for (const id of sources) {
      try { await timed(`delete-source:${id}`, () => remove(`/sandboxes/${id}`)); }
      catch (error) { cleanupErrors.push(String(error)); }
    }
    for (const id of owned) {
      try {
        const found = await api("GET", `/sandboxes/${id}`);
        expect(found.response.status === 404 || found.record?.state === "destroyed").toBe(true);
        emit("sandbox-cleanup-verified", { id, httpStatus: found.response.status, state: found.record?.state });
      } catch (error) { cleanupErrors.push(String(error)); }
    }
    emit("cleanup-summary", { sandboxIds: [...owned], snapshotIds: [...snapshots.keys()], cleanupErrors });
    globalThis.fetch = nativeFetch;
    closeMiosaConnections();
  }
  expect(cleanupErrors).toEqual([]);
  if (workloadError) throw workloadError;
}, 300_000);

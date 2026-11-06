import { afterAll, beforeAll } from "vitest";
import { closeMiosaConnections, closeMiosaRunnerConnections } from "../index";

export function installSnapshotAudit() {
  const started = Date.now();
  const baseUrl = (process.env.MIOSA_BASE_URL ?? "https://api.miosa.ai/api/v1").replace(/\/+$/, "");
  const nativeFetch = globalThis.fetch;
  const owned = new Set([
    "9b27d0e3-104d-4a4e-b6db-e631217a89de",
    "ea1bad72-eba6-4f6d-b4f5-8fb6782cfc82",
  ]);
  const snapshots = new Map([["820a8de7-02e7-42d8-ab80-2680878c4232", "9b27d0e3-104d-4a4e-b6db-e631217a89de"]]);
  const active = new Set<AbortController>();
  let shutdown = false;
  const emit = (event: string, values: Record<string, unknown> = {}) =>
    console.log("MIOSA_CLEAN_AUDIT", JSON.stringify({ event, elapsedMs: Date.now() - started, ...values }));
  const fields = (r: any) => ({ id: r?.id, state: r?.state, status: r?.status, ready: r?.ready, sandboxId: r?.sandbox_id });

  beforeAll(() => {
    globalThis.fetch = async (input, init) => {
      if (shutdown && init?.method !== "DELETE") throw new Error("Post-suite cleanup: workload requests are stopped");
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const path = url.pathname;
      const method = init?.method ?? "GET";
      const begin = Date.now();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      emit("http-start", { method, path, request: body ? {
        wait: body.wait, persistent: body.persistent, timeoutSec: body.timeout_sec,
        runtimeProfile: body.runtime_profile, snapshotId: body.snapshot_id,
        waitTimeoutMs: body.wait_timeout_ms,
      } : undefined });
      const controller = new AbortController();
      active.add(controller);
      try {
        const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        const response = await nativeFetch(input, { ...init, signal });
        const payload = await response.clone().json().catch(() => undefined);
        const record = payload?.data ?? payload;
        if (response.ok && method === "POST" && path.endsWith("/sandboxes") && record?.id) owned.add(record.id);
        const owner = path.match(/\/sandboxes\/([^/]+)\/snapshots$/)?.[1];
        if (response.ok && method === "POST" && owner && record?.id) snapshots.set(record.id, owner);
        emit("http-end", { method, path, durationMs: Date.now() - begin, httpStatus: response.status,
          record: Array.isArray(record) ? undefined : fields(record),
          snapshots: owner && Array.isArray(record) ? record.map(fields) : undefined,
          errorCode: payload?.error?.code ?? payload?.code,
        });
        return response;
      } catch (error) {
        emit("http-error", { method, path, durationMs: Date.now() - begin, error: String(error) });
        throw error;
      } finally { active.delete(controller); }
    };
  });

  afterAll(async () => {
    shutdown = true;
    for (const controller of active) controller.abort();
    const deadline = Date.now() + 80_000;
    const errors: string[] = [];
    const api = async (method: string, path: string) => {
      const begin = Date.now();
      const response = await nativeFetch(`${baseUrl}${path}`, { method, headers: {
        authorization: `Bearer ${process.env.MIOSA_API_KEY}`, "content-type": "application/json",
      }, signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))) });
      const payload: any = await response.json().catch(() => undefined);
      const record = payload?.data ?? payload;
      emit("cleanup-http", { method, path, durationMs: Date.now() - begin, httpStatus: response.status,
        record: Array.isArray(record) ? record.map(fields) : fields(record),
        errorCode: payload?.error?.code ?? payload?.code,
        errorMessage: payload?.error?.message ?? payload?.message,
      });
      return { response, record };
    };
    const destroyAndVerify = async (id: string) => {
      const found = await api("GET", `/sandboxes/${id}`);
      if (found.response.status === 404 || found.record?.state === "destroyed") {
        emit("sandbox-cleanup-verified", { id });
        return;
      }
      const deleted = await api("DELETE", `/sandboxes/${id}`);
      if (!deleted.response.ok && deleted.response.status !== 404) throw new Error(`Delete sandbox ${id}: HTTP ${deleted.response.status}`);
      for (let attempt = 0; attempt < 10; attempt++) {
        const checked = await api("GET", `/sandboxes/${id}`);
        if (checked.response.status === 404 || checked.record?.state === "destroyed") {
          emit("sandbox-cleanup-verified", { id });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error(`Sandbox ${id} not confirmed destroyed`);
    };
    try {
      emit("cleanup-start", { sandboxIds: [...owned], snapshotIds: [...snapshots.keys()] });
      await new Promise((resolve) => setTimeout(resolve, 2_100));
      for (const id of owned) {
        try {
          const listed = await api("GET", `/sandboxes/${id}/snapshots`);
          for (const snap of Array.isArray(listed.record) ? listed.record : []) {
            if (snap.id && snap.status !== "deleted") snapshots.set(snap.id, id);
          }
        } catch (error) { errors.push(String(error)); }
      }
      const sources = new Set(snapshots.values());
      for (const id of [...owned].filter((id) => !sources.has(id))) {
        try { await destroyAndVerify(id); } catch (error) { errors.push(String(error)); }
      }
      for (const id of sources) {
        try { await destroyAndVerify(id); } catch (error) { errors.push(String(error)); }
      }
      for (const [id, owner] of snapshots) {
        try {
          let removed = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            const deleted = await api("DELETE", `/sandboxes/${owner}/snapshots/${id}`);
            if (deleted.response.ok || deleted.response.status === 404) { removed = true; break; }
            if (deleted.response.status !== 409) break;
            await new Promise((resolve) => setTimeout(resolve, 2_000));
          }
          if (!removed) throw new Error(`Snapshot ${id} could not be deleted`);
          const listed = await api("GET", `/sandboxes/${owner}/snapshots`);
          if (!listed.response.ok || !Array.isArray(listed.record) || listed.record.some((r: any) => r.id === id && r.status !== "deleted")) {
            throw new Error(`Snapshot ${id} absence unverified after DELETE`);
          }
          emit("snapshot-cleanup-verified", { id, owner });
        } catch (error) { errors.push(String(error)); }
      }
    } finally {
      emit("cleanup-summary", { sandboxIds: [...owned], snapshotIds: [...snapshots.keys()], errors });
      globalThis.fetch = nativeFetch;
      closeMiosaConnections();
      await closeMiosaRunnerConnections();
    }
    if (errors.length) throw new Error(`MIOSA cleanup audit: ${errors.join("; ")}`);
  }, 90_000);
}

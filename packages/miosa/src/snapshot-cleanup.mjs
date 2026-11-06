import { setTimeout as delay } from "node:timers/promises";

const sandboxId = "eee580f4-76c6-4779-9a23-23bcea423987";
const baseUrl = (process.env.MIOSA_BASE_URL ?? "https://api.miosa.ai/api/v1").replace(/\/+$/, "");
const apiKey = process.env.MIOSA_API_KEY;
if (!apiKey) throw new Error("MIOSA_API_KEY missing; no cleanup attempted");
const started = Date.now();
const deadline = started + 90_000;
const redact = (value) => value == null ? undefined : String(value).replaceAll(apiKey, "[REDACTED]").slice(0, 1200);
const emit = (event, fields = {}) => console.log("MIOSA_CLEANUP_ONLY", JSON.stringify({
  event, sandboxId, elapsedMs: Date.now() - started, ...fields,
}));
let getCount = 0;
let deleteCount = 0;
let nextDeleteAt = started;
let finalState;
let finalHttpStatus;
let verified = false;

async function request(method) {
  if (method !== "GET" && method !== "DELETE") throw new Error("Cleanup permits GET/DELETE only");
  const begin = Date.now();
  if (begin >= deadline) throw new Error("Cleanup deadline exhausted");
  if (method === "GET") getCount++;
  else deleteCount++;
  const response = await fetch(`${baseUrl}/sandboxes/${sandboxId}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - begin))),
  });
  const payload = await response.json().catch(() => undefined);
  const record = payload?.data ?? payload;
  emit("native-response", {
    method, httpStatus: response.status, durationMs: Date.now() - begin,
    state: record?.state, ready: record?.ready, destroyedAt: record?.destroyed_at,
    lastError: redact(record?.metadata?.last_error),
    errorCode: payload?.error?.code ?? payload?.code,
    errorMessage: redact(payload?.error?.message ?? payload?.message),
  });
  return { response, record };
}

emit("bounds", { budgetMs: 90_000, maxDeleteAttempts: 3, maxGetAttempts: 26, testsRun: 0, sandboxCreates: 0 });
try {
  while (Date.now() < deadline && getCount < 26) {
    const { response, record } = await request("GET");
    finalHttpStatus = response.status;
    finalState = record?.state;
    if (response.status === 404 || (response.ok && record?.state === "destroyed")) {
      verified = true;
      break;
    }
    if (!response.ok) throw new Error(`Inspection failed: HTTP ${response.status}`);
    if (deleteCount < 3 && Date.now() >= nextDeleteAt) {
      const deletion = await request("DELETE");
      nextDeleteAt = Date.now() + 30_000;
      if (!deletion.response.ok && deletion.response.status !== 404 && deletion.response.status !== 409) {
        throw new Error(`Deletion failed: HTTP ${deletion.response.status}`);
      }
    }
    if (Date.now() + 3_000 >= deadline) break;
    await delay(3_000);
  }
} catch (error) {
  emit("cleanup-error", { error: redact(error) });
} finally {
  emit("final", { getCount, deleteCount, finalHttpStatus, finalState, verified, testsRun: 0, sandboxCreates: 0 });
}
if (!verified) process.exitCode = 1;

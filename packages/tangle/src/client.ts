import type { Sandbox, SandboxInstance, SandboxInfo } from '@tangle-network/sandbox';
import { http2Fetch, openConnections, sdk } from './http2';

export { openConnections };
export const defaultBaseUrl = process.env.TANGLE_SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools';

export interface TangleClient extends Sandbox {
  fromCreateResponse(data: Record<string, any>): SandboxInstance;
}

export function createSdkClient(apiKey: string, baseUrl: string): TangleClient {
  const { Sandbox, SandboxInstance, NetworkError, TimeoutError } = sdk();
  class Http2Sandbox extends Sandbox {
    fromCreateResponse(data: Record<string, any>): SandboxInstance {
      return new SandboxInstance(this, {
        id: data.id ?? "",
        name: data.name,
        filesystemIncarnationId: data.filesystemIncarnationId,
        filesystemIncarnationProvenance: data.filesystemIncarnationProvenance,
        filesystemIncarnationReadiness: data.filesystemIncarnationReadiness,
        status: data.status ?? "pending",
        connection: normalizeConnection(data.connection),
        metadata: data.metadata,
        createdAt: data.createdAt ? new Date(data.createdAt) : /* @__PURE__ */ new Date(),
        startedAt: data.startedAt ? new Date(data.startedAt) : void 0,
        lastActivityAt: data.lastActivityAt ? new Date(data.lastActivityAt) : void 0,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : void 0,
        error: data.error,
        gpuLease: data.gpuLease,
        resources: normalizeSandboxShape(data.resources),
        startupDiagnostics: normalizeStartupDiagnostics(data.startupDiagnostics) ?? void 0,
        createReceipt: normalizeSandboxCreateReceipt(data.createReceipt) ?? void 0,
        captureProof: normalizeCaptureProof(data.captureProof) ?? void 0,
        compliance: data.compliance && typeof data.compliance === "object" && data.compliance.hipaa === true ? { hipaa: true } : void 0
      } as SandboxInfo);
    }

    private readonly authorization = new Headers({ authorization: 'Bearer ' + this.getApiKey() }).get('authorization')!;

    override async fetch(path: string, options: RequestInit = {}, fetchOptions?: { timeoutMs?: number }): Promise<Response> {
      const timeoutMs = fetchOptions?.timeoutMs ?? 30_000;
      try {
        const response = await http2Fetch(new URL(this.getBaseUrl() + path), options, {
          timeoutMs, authorization: this.authorization,
        });
        response.headers.set('x-tangle-request-path', path);
        if (options.method) response.headers.set('x-tangle-request-method', options.method);
        return response;
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (error instanceof TimeoutError) throw error;
        throw new NetworkError('Failed to connect to Tangle Sandbox API', error instanceof Error ? error : undefined);
      }
    }
  }
  return new Http2Sandbox({ apiKey, baseUrl, trustLocalCliAuth: false });
}

// Normalize only on native-handle access, using the pinned SDK wire contract.
function normalizeConnection(raw: any): any {
  if (!raw || typeof raw !== "object") return void 0;
  const c = raw;
  const runtimeUrl = c.runtimeUrl;
  const edgeStatus = normalizeEdgeStatus(c.edgeStatus);
  const ssh = normalizeSshCredentials(c.ssh);
  const webTerminalUrl = c.webTerminalUrl;
  if (!runtimeUrl && !edgeStatus && !ssh && !webTerminalUrl) return void 0;
  return {
    runtimeUrl,
    authToken: c.authToken,
    authTokenExpiresAt: c.authTokenExpiresAt,
    edgeStatus,
    edgeReadyAt: c.edgeReadyAt,
    edgeError: c.edgeError,
    ssh,
    webTerminalUrl
  };
}
function normalizeEdgeStatus(raw: any): any {
  return raw === "pending" || raw === "ready" || raw === "failed" || raw === "skipped" ? raw : void 0;
}
/**
* Narrow a raw `ssh` payload into a `SSHCredentials` object. Returns
* `undefined` if the payload is missing required fields so callers that
* dereference `connection.ssh.proxyCommand` don't surprise-crash on partial
* server responses.
*/
function normalizeSshCredentials(raw: any): any {
  if (!raw || typeof raw !== "object") return void 0;
  const s = raw;
  if (typeof s.port !== "number" || typeof s.username !== "string" || typeof s.proxyCommand !== "string" || s.proxyCommand.length === 0) return;
  return {
    username: s.username,
    port: s.port,
    proxyCommand: s.proxyCommand
  };
}
/**
* Narrow a raw `resources` grant into a `SandboxShape`. Returns `undefined`
* when any of the three sizing terms is missing, so a payload that carries no
* grant (a list row, an older sandbox) leaves the caller's known grant alone
* rather than overwriting it with a partial object.
*/
function normalizeSandboxShape(raw: any): any {
  if (!raw || typeof raw !== "object") return void 0;
  const r = raw;
  if (typeof r.cpuCores !== "number" || typeof r.memoryMB !== "number" || typeof r.diskGB !== "number") return;
  return {
    cpuCores: r.cpuCores,
    memoryMB: r.memoryMB,
    diskGB: r.diskGB,
    ...typeof r.pool === "string" ? { pool: r.pool } : {},
    ...typeof r.ttlMs === "number" ? { ttlMs: r.ttlMs } : {}
  };
}
function normalizeStartupDiagnostics(raw: any): any {
  if (!raw || typeof raw !== "object") return null;
  const rawOperations = raw.operations;
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) return null;
  const operations = [];
  const phases: Record<string, number> = {};
  for (const entry of rawOperations) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry;
    const operation = record.operation;
    if (typeof operation !== "string") continue;
    const durationMs = typeof record.durationMs === "number" ? record.durationMs : void 0;
    operations.push({
      operation,
      service: typeof record.service === "string" ? record.service : void 0,
      status: typeof record.status === "string" ? record.status : void 0,
      durationMs,
      parent: typeof record.parent === "string" ? record.parent : void 0,
      metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : void 0
    });
    if (durationMs !== void 0) phases[operation] = durationMs;
  }
  if (operations.length === 0) return null;
  return {
    operations,
    phases
  };
}
const SANDBOX_CREATE_OUTCOMES = [
  "created",
  "idempotent_replay",
  "unknown"
];
/**
* Normalize the raw `createReceipt` field from a sandbox API response into a
* {@link SandboxCreateReceipt}. Returns `null` when the payload is absent or
* carries no boolean `idempotencyKeyApplied` — the platform emits the receipt
* only on the create response, so most reads have no payload to normalize.
*
* An outcome this SDK version does not know becomes `unknown`: only a known
* `created` proves that the call allocated the environment.
*/
function normalizeCaptureProof(raw: any): any {
  if (!raw || typeof raw !== "object") return null;
  const proof = raw;
  if (typeof proof.hostId !== "string" || proof.hostId.length === 0 || typeof proof.containerId !== "string" || !/^[a-f0-9]{64}$/.test(proof.containerId) || typeof proof.imageId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(proof.imageId) || typeof proof.bundleRevision !== "string" || !/^[a-f0-9]{40}$/.test(proof.bundleRevision) || typeof proof.bundleChecksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(proof.bundleChecksum)) return null;
  return {
    hostId: proof.hostId,
    containerId: proof.containerId,
    imageId: proof.imageId,
    bundleRevision: proof.bundleRevision,
    bundleChecksum: proof.bundleChecksum
  };
}
export function normalizeSandboxCreateReceipt(raw: any): any {
  if (!raw || typeof raw !== "object") return null;
  const record = raw;
  const idempotencyKeyApplied = record.idempotencyKeyApplied;
  if (typeof idempotencyKeyApplied !== "boolean") return null;
  const outcome = SANDBOX_CREATE_OUTCOMES.includes(record.outcome) ? record.outcome : "unknown";
  const injectedSecrets = Array.isArray(record.injectedSecrets) ? record.injectedSecrets.filter((name: unknown) => typeof name === "string") : void 0;
  return {
    outcome,
    idempotencyKeyApplied,
    ...record.ownerContext === "inherit" || record.ownerContext === "isolated" ? { ownerContext: record.ownerContext } : {},
    ...injectedSecrets ? { injectedSecrets } : {},
    ...normalizeCaptureProof(record.captureProof) ? { captureProof: normalizeCaptureProof(record.captureProof) ?? void 0 } : {}
  };
}

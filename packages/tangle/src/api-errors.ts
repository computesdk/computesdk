// Wire error mapping follows the pinned Sandbox SDK's src/errors.ts.
// Its parser is private; preserve the public error classes and metadata here.
import { sdk } from './http2';

type WireObject = Record<string, any>;
type Context = { method?: string; path?: string; allPreviousCreateAttemptsRefused?: boolean };

const NON_RETRYABLE_CREATE_QUOTA_REASONS = new Set([
  "CONCURRENT_LIMIT",
  "CREDIT_EXHAUSTED",
  "EGRESS_LIMIT"
]);
function quotaTypeFromResponse(data: WireObject, reason?: string) {
  const normalizedReason = reason?.trim().toUpperCase();
  if (normalizedReason && NON_RETRYABLE_CREATE_QUOTA_REASONS.has(normalizedReason)) return normalizedReason;
  if (typeof data.quotaType === "string" && data.quotaType.trim()) return data.quotaType;
  return "rate_limit";
}
function readGpuProviderRequirements(data: WireObject) {
  return (Array.isArray(data.providers) ? data.providers : []).flatMap((entry: any) => {
    if (!isFailureDetail(entry)) return [];
    const provider = asString(entry.provider);
    const state = asString(entry.state);
    const envVars = Array.isArray(entry.envVars) ? entry.envVars : [];
    if (!provider || !state) return [];
    return [{
      provider,
      state,
      envVars: envVars.filter((name: unknown) => typeof name === "string")
    }];
  });
}
function parseRetryAfterMs(rawValue: string | undefined, data: WireObject) {
  if (typeof data.retryAfterMs === "number" && Number.isFinite(data.retryAfterMs)) return Math.max(0, data.retryAfterMs);
  if (!rawValue) return void 0;
  const trimmed = rawValue.trim();
  if (!trimmed) return void 0;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1e3;
  const targetTs = Date.parse(trimmed);
  if (!Number.isNaN(targetTs)) return Math.max(0, targetTs - Date.now());
}
/**
* The server's published wait, in seconds. Only a positive finite number is
* a wait; anything else is absent. Never derived from `Retry-After` — that
* header is a pacing hint every refusal carries, while `etaSeconds` is a
* measurement the cell only publishes when it has one.
*/
function parseEtaSeconds(data: WireObject) {
  const raw = data.etaSeconds;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return;
  return raw;
}
function inferOrigin(headers?: Headers, context?: Context) {
  const derivedPath = context?.path ?? headers?.get("x-tangle-request-path") ?? void 0;
  if (!headers) return context?.path ? "sandbox-api" : void 0;
  if (headers.has("x-sidecar-version") || headers.has("x-sidecar-image") || headers.has("x-sidecar-image-tag")) return "sidecar";
  if (headers.has("x-orchestrator-version")) return "control-plane";
  if (derivedPath?.startsWith("/v1/")) return "sandbox-api";
  if (derivedPath) {
    if (derivedPath.startsWith("/projects") || derivedPath.startsWith("/sidecars") || derivedPath.startsWith("/instances")) return "control-plane";
    return "runtime";
  }
  return "unknown";
}
function isQuotaCode(code?: string) {
  return code === "QUOTA_EXCEEDED" || code?.endsWith("_QUOTA_EXCEEDED") === true;
}
function isCapabilityCode(code?: string) {
  return code === "CAPABILITY_NOT_ENABLED" || code === "CAPABILITY_UNSUPPORTED" || code === "UNSUPPORTED_CAPABILITY" || code === "FLEET_SHARED_WORKSPACE_UNSUPPORTED" || code === "SHARED_WORKSPACE_UNSUPPORTED";
}
function isPartialFailureCode(code?: string) {
  return code === "PARTIAL_FAILURE" || code === "FLEET_PARTIAL_FAILURE" || code === "FLEET_DISPATCH_PARTIAL_FAILURE" || code === "FLEET_DEPROVISION_FAILED";
}
function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
function asErrorCode(value: unknown) {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value) ? value : void 0;
}
function isFailureDetail(value: any) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function readKeyBudgetDetails(value: WireObject) {
  if (!isFailureDetail(value)) return {};
  return {
    keyId: asString(value.keyId),
    budgetUsd: finiteNumber(value.budgetUsd),
    spentUsd: finiteNumber(value.spentUsd),
    reservedUsd: finiteNumber(value.reservedUsd)
  };
}
function readCapability(data: WireObject, errorObj: any) {
  const nested = typeof errorObj === "object" && errorObj !== null ? asString(errorObj.capability) : void 0;
  return asString(data.capability) ?? nested;
}
function readFileWriteConflictDetails(errorObj: any) {
  if (typeof errorObj !== "object" || errorObj === null) return void 0;
  const path = asString(errorObj.path);
  const expectedHash = errorObj.expectedHash === void 0 ? void 0 : asString(errorObj.expectedHash);
  const currentHash = errorObj.currentHash === null ? null : asString(errorObj.currentHash);
  const currentMtime = errorObj.currentMtime === null && Object.hasOwn(errorObj, "currentMtime") ? null : typeof errorObj.currentMtime === "number" && Number.isFinite(errorObj.currentMtime) ? errorObj.currentMtime : void 0;
  if (path === void 0 || errorObj.expectedHash !== void 0 && expectedHash === void 0 || currentHash === void 0 || currentMtime === void 0) return;
  return {
    path,
    expectedHash,
    currentHash,
    currentMtime
  };
}
function readFailures(data: WireObject, errorObj: any) {
  if (Array.isArray(data.failures)) return data.failures.filter(isFailureDetail);
  if (Array.isArray(data.results)) {
    const failures = data.results.filter((result: any) => typeof result === "object" && result !== null && result.ok === false);
    if (failures.length > 0) return failures.filter(isFailureDetail);
  }
  if (typeof errorObj === "object" && errorObj !== null && Array.isArray(errorObj.failures)) return errorObj.failures.filter(isFailureDetail);
}
/**
* Parse an error response from the API.
* @param status - HTTP status code
* @param body - Response body text
* @param context - Optional request context for better error messages
*/
export function parseErrorResponse(status: number, body: string, context?: Context, headers?: Headers) {
  const { SandboxError, AuthError, NotFoundError, QuotaError, CapabilityError,
  GpuProviderNotConfiguredError, PartialFailureError, EgressProxyRecoveryError,
  ResumeEnvRequiredError, BranchFanoutExceedsHostError, KeyBudgetExhaustedError,
  FileWriteConflictError, ServerError, TimeoutError, StateError, ValidationError, } = sdk();

  let data;
  try {
    const parsed = JSON.parse(body);
    data = parsed && typeof parsed === "object" ? parsed : { message: body };
  } catch {
    data = { message: body };
  }
  const errorObj = data.error;
  const nestedMessage = typeof errorObj === "object" && errorObj !== null ? errorObj.message : void 0;
  const nestedCode = typeof errorObj === "object" && errorObj !== null ? typeof errorObj.code === "string" ? asErrorCode(errorObj.code) : void 0 : void 0;
  const baseMessage = data.message || nestedMessage || (typeof errorObj === "string" ? errorObj : void 0) || body || "Unknown error";
  const details = typeof data.details === "string" && data.details.trim().length > 0 ? data.details.trim() : void 0;
  const shouldAppendDetails = !!details && details !== baseMessage && (baseMessage === "Unknown error" || /^failed\b/i.test(baseMessage) || /^provision failed\b/i.test(baseMessage) || /^deprovision failed\b/i.test(baseMessage));
  const rawReason = typeof data.reason === "string" ? data.reason : typeof errorObj === "object" && errorObj !== null ? errorObj.reason : void 0;
  const reason = typeof rawReason === "string" && rawReason.trim().length > 0 ? rawReason.trim() : void 0;
  const code = (typeof data.code === "string" ? asErrorCode(data.code) : void 0) ?? nestedCode;
  const rawLog = typeof errorObj === "object" && errorObj !== null ? errorObj.log : void 0;
  const logTail = typeof rawLog === "string" && rawLog.trim().length > 0 ? rawLog.trim() : void 0;
  const prefix = context?.method || context?.path ? `${context.method ?? "REQUEST"} ${context.path ?? ""}: ` : "";
  const composedMessage = shouldAppendDetails ? `${baseMessage}: ${details}` : baseMessage;
  const messageWithReason = `${prefix}${reason && !composedMessage.includes(reason) ? `${composedMessage}: ${reason}` : composedMessage}`;
  const message = logTail && !messageWithReason.includes(logTail) ? `${messageWithReason}\n${logTail}` : messageWithReason;
  const metadata: ConstructorParameters<typeof import('@tangle-network/sandbox').SandboxError>[3] = {
    origin: inferOrigin(headers, context),
    endpoint: context?.path ?? headers?.get("x-tangle-request-path") ?? void 0,
    retryAfterMs: parseRetryAfterMs(headers?.get("retry-after") ?? void 0, data),
    etaSeconds: parseEtaSeconds(data),
    sidecarVersion: headers?.get("x-sidecar-version") ?? void 0,
    containerImage: headers?.get("x-sidecar-image") ?? headers?.get("x-sidecar-image-tag") ?? void 0,
    createFailureDisposition: context?.allPreviousCreateAttemptsRefused === true && (context.method ?? headers?.get("x-tangle-request-method")) === "POST" && (context.path ?? headers?.get("x-tangle-request-path")) === "/v1/sandboxes" && status === 429 && (code === "RATE_LIMIT_EXCEEDED" || code === "QUOTA_EXCEEDED" || code === "PLATFORM_RATE_LIMITED") ? "not-admitted" : void 0
  };
  if (isQuotaCode(code)) return new QuotaError(quotaTypeFromResponse(data, reason), message, data.current, data.limit, metadata, status);
  if (code === "GPU_PROVIDER_NOT_CONFIGURED" || code === "GPU_PROVIDERS_NOT_CONFIGURED") return new GpuProviderNotConfiguredError(message, readGpuProviderRequirements(data), status, metadata);
  if (isCapabilityCode(code)) return new CapabilityError(message, code, status, metadata, readCapability(data, errorObj));
  if (isPartialFailureCode(code)) return new PartialFailureError(message, code, status, metadata, readFailures(data, errorObj));
  if (code === "EGRESS_PROXY_RECOVERY_REQUIRED") return new EgressProxyRecoveryError(message, metadata);
  if (code === "RESUME_ENV_REQUIRED") {
    const keys = data.missingEnvKeys;
    return new ResumeEnvRequiredError(message, Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [], metadata);
  }
  if (code === "BRANCH_FANOUT_EXCEEDS_HOST") {
    const count = (raw: unknown) => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : void 0;
    return new BranchFanoutExceedsHostError(message, {
      maxChildren: count(data.maxChildren),
      requestedChildren: count(data.requestedChildren)
    }, metadata);
  }
  if (code === "KEY_BUDGET_EXHAUSTED") return new KeyBudgetExhaustedError(message, readKeyBudgetDetails(data.details), metadata);
  if (code === "FILE_WRITE_CONFLICT") {
    const conflict = readFileWriteConflictDetails(errorObj);
    if (!conflict) return new ServerError(`${message}: malformed FILE_WRITE_CONFLICT response`, 502, metadata, "INVALID_ERROR_RESPONSE");
    return new FileWriteConflictError(message, conflict.path, conflict.expectedHash, conflict.currentHash, conflict.currentMtime, metadata);
  }
  switch (status) {
    case 400: return new ValidationError(message, data.fields, metadata, code);
    case 401: return new AuthError(message, metadata);
    case 404: return new NotFoundError(data.resourceType || "Resource", data.resourceId || "unknown", metadata, message, code);
    case 408: return new TimeoutError(data.timeoutMs || 3e4, message, metadata);
    case 409: return new StateError(message, data.currentState || "unknown", data.requiredState, metadata, code);
    case 429: return new QuotaError(quotaTypeFromResponse(data, reason), message, data.current, data.limit, metadata);
    case 501: return new SandboxError(message, code || "NOT_IMPLEMENTED", status, metadata);
    default:
      if (status >= 500) return new ServerError(message, status, metadata, code);
      return new SandboxError(message, code || "UNKNOWN_ERROR", status, metadata);
  }
}

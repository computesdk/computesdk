/**
 * `@computesdk/platform` — the hosted ComputeSDK platform provider, plus the
 * platform HTTP client shared with `@computesdk/cli`.
 */

export { platform } from './provider.js';
export type {
  PlatformConfig,
  PlatformCreateOptions,
  PlatformSize,
} from './provider.js';

export {
  DEFAULT_BASE_URL,
  MARKET_CODES,
  PlatformApiError,
  PlatformClient,
  PlatformClientError,
  codeForStatus,
  errorDetails,
  isSecurePlatformTransport,
  isTrustedPlatformHost,
  readSseEvents,
  readSseNamedEvents,
  resolvePlatformAuth,
  toErrorEnvelope,
} from './client.js';
export type {
  PlatformApiErrorCode,
  PlatformAuth,
  PlatformClientErrorCode,
  PlatformErrorEnvelope,
  RequestOpts,
  StoredPlatformAuth,
  StoredPlatformAuthResolver,
} from './client.js';

// Sandbox wire types. `CommandResult`/`FileEntry` are the platform wire
// shapes (commandId, modified as ISO string) — distinct from the SDK
// interface types of the same names in `computesdk`.
export type {
  CommandResult,
  FileEntry,
  PathView,
  SandboxCost,
  SandboxDetail,
  SandboxProcess,
  SandboxProcessStatus,
  SandboxSnapshot,
  SandboxSummary,
} from './types.js';

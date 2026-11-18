// Compatibility export: keep error classes and auth shared with computesdk.
export { DEFAULT_BASE_URL, MARKET_CODES, PlatformApiError, PlatformClient, PlatformClientError, codeForStatus, errorDetails, isSecurePlatformTransport, isTrustedPlatformHost, readSseEvents, readSseNamedEvents, resolvePlatformAuth, toErrorEnvelope } from 'computesdk';
export type { PlatformApiErrorCode, PlatformAuth, PlatformClientErrorCode, PlatformErrorEnvelope, RequestOpts, StoredPlatformAuth, StoredPlatformAuthResolver } from 'computesdk';

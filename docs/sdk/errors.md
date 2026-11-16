# Errors, limits and safe retries

## Commands and API failures

Check `result.exitCode` after `runCommand()`. A nonzero remote command exit is different from an API or network failure, which throws. Use `try/finally` to destroy the sandbox regardless of the command outcome; see the [complete example](../getting-started/sdk-quick-start.md).

The package exports `PlatformApiError` for API failures and `PlatformClientError` for local transport, authentication and validation errors. In a multi-provider core SDK call, errors may be aggregated under `error.errors`.

`PlatformApiError` exposes `status`, `code`, `details` and `retryable`. The code comes from response details, a top-level code, or the HTTP status. Inspect `details` for placement attempts and other diagnostic context.

## Limits

- File reads and writes through `filesystem` are limited to approximately 4 MB of UTF-8 data per call.
- Buffered command timeouts are capped at 290 seconds; use `runCommand(command, { background: true })` for longer work.
- Command length is limited to 64 KB.
- Sandbox creation accepts up to 100 vault secret names.

A create's `timeout` controls the sandbox lifetime in milliseconds. A command's `timeout` controls command execution in milliseconds. Stopping a command does not destroy the sandbox.

## Idempotent creation

Each create generates an `sdk-create:<uuid>` idempotency key. Replays inside that create reuse the same key. To make a create safe across process restarts, supply a stable key:

```typescript
import type { PlatformCreateOptions } from '@computesdk/platform';

const options: PlatformCreateOptions = {
  size: 'small',
  idempotencyKey: 'my-job-unique-id',
};
const sandbox = await sdk.instances.create(options);
```

Here `sdk` is the configured client from the [quickstart](../getting-started/sdk-quick-start.md). Same key and request returns the existing sandbox, including a terminal sandbox; a different request with that key fails with `idempotency_key_reused` (409). A failed placement frees the key.

If create throws `create_outcome_unknown`, a sandbox may already exist and be billing. Inspect the org dashboard before trying another placement. This error suppresses core SDK fallback to avoid allocating a second sandbox.

## Automatic retries

The provider retries `sandbox_booting` with backoff for approximately 60 seconds, rate limits using `Retry-After`, and network errors on GET/DELETE. Create recovery uses its idempotency key. Other POST operations are not generally retried.

Capacity, credit and routing errors need a changed condition. Inspect codes such as `insufficient_credits`, `no_market_capacity`, `no_provider_configured` and `limit_not_met`; retrying the same request is not a substitute for configuring a valid route.

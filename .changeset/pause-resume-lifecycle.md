---
"computesdk": minor
"@computesdk/provider": minor
"@computesdk/e2b": minor
"@computesdk/daytona": minor
"@computesdk/superserve": minor
"@computesdk/isorun": minor
"@computesdk/codesandbox": minor
"@computesdk/createos-sandbox": minor
"@computesdk/tenki": minor
"@computesdk/agentuity": minor
"@computesdk/namespace": minor
"@computesdk/test-utils": minor
---

Add pause/resume lifecycle API to ComputeSDK sandboxes.

- Core API: `sandbox.pause({ keepMemory? })` and `sandbox.resume()` with a new `'paused'` status in `SandboxInfo`.
- Provider factory wiring for optional `pause`/`resume` methods.
- Native pause/resume implementations for E2B, Daytona, Superserve, Isorun, CodeSandbox, CreateOS, Tenki, Agentuity, and Namespace.
- Namespace pause/resume uses the `SuspendInstance`/`WakeInstance` Compute API endpoints.
- Added unit tests for the Namespace pause/resume lifecycle.
- Added `supportsPauseResume` option to the provider test suite and enabled it for E2B.
- Added an E2B pause/resume integration test to `compute-provider-integration.test.ts`.

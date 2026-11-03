---
"@computesdk/test-utils": patch
---

Make compute-provider test execution and cleanup fail honestly. Ordinary skipped integration suites no longer silently substitute framework mocks; explicit unit helpers retain labeled framework self-tests. Isolate per-invocation hooks and retain late allocation ownership, enforce bounded cleanup, and reject missing command exit status.

CRUD tests retain legacy opt-in defaults, add an explicit execution opt-in, replace blind sleeps with bounded SDK-absence verification, and fail on unverified cleanup. The strict native conformance gate rejects skipped/mock execution. These test-infrastructure changes do not certify native behavior or guarantee cancellation of pending provider operations.

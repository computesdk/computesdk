---
"@computesdk/modal": patch
---

Reject unsupported native command timeout precision before launching a provider-backed command, instead of returning a synthetic guest exit code 127.

The pinned Modal SDK accepts positive whole multiples of 1000 milliseconds. Invalid values, explicit zero, and fractional-second precision now raise `MODAL_COMMAND_TIMEOUT_UNSUPPORTED`. Supported values and omission pass through unchanged; no rounding, universal zero semantics, or new cancellation guarantees are introduced.

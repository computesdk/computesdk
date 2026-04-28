---
"computesdk": major
"@computesdk/provider": major
"@computesdk/test-utils": major
---

Remove `Runtime` concept from SDK

The `Runtime` type (`'node' | 'python' | 'deno' | 'bun'`) and associated
`getSupportedRuntimes()` method were originally designed to support a
`runCode()` API that has since been removed. With no runtime-dispatch logic
remaining in the SDK, these are dead API surface.

**Breaking changes:**

- `Runtime` type removed from `computesdk` public exports
- `runtime` field removed from `SandboxInfo`
- `getSupportedRuntimes(): Runtime[]` removed from the `Provider` interface
- Provider implementations no longer need to (and cannot) implement `getSupportedRuntimes()`
- Test suite no longer iterates per-runtime; tests run once per sandbox

**Migration:** Remove any calls to `provider.getSupportedRuntimes()` and any
references to `SandboxInfo.runtime` in your code.

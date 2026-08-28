---
"@computesdk/opencomputer": patch
---

Start the `@opencomputer/sdk` import at module load instead of at first use.

The SDK initialises at import. `loadSandbox()` is first reached from
`sandbox.create()`, so deferring the import there meant that initialisation
happened during the first create rather than before it.

The import stays dynamic: the SDK is ESM-only with top-level await, so a static
import compiles to `require()` in this package's CJS build and fails to load.

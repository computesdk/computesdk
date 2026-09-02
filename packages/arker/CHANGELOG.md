# @computesdk/arker

## 0.1.4

### Patch Changes

- cbeb015: Update to `@arker-ai/sdk` ^1.2.4 and adapt to its 1.x interface.

  The 1.x SDK changed three things this provider relied on:

  - **`provider` and `region` must now be supplied together.** The provider previously passed only `region`, defaulting to the combined string `aws-us-east-1`, which throws under 1.x. Provider and region are now resolved separately (config → `ARKER_PROVIDER` / `ARKER_REGION` → `aws` / `us-east-1`), and a combined `"<provider>-<region>"` region is split automatically so existing callers keep working unchanged.
  - **`fork(name, options)` was removed** in favour of a single options object keyed by the wire schema, so forks now pass `source_vm_name` / `source_vm_id`. These fields are only accepted from 1.2.4, which is why the floor is ^1.2.4 and not ^1.2.3.
  - **`run()` selects its result type from `time_to_background`.** The provider was passing a `background: false` flag the SDK does not define, which missed the typed overloads and returned the `CompletedRunResult | BackgroundRunResult` union. Leaving `time_to_background` unset selects the synchronous overload, where the SDK polls the run to completion itself and resolves `CompletedRunResult`.

  Adds an optional `provider` config field (env: `ARKER_PROVIDER`).

## 0.1.3

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.2

### Patch Changes

- d14a9d7: Drop custom output decoding and background-run polling now handled by the Arker SDK; require @arker-ai/sdk ^0.9.0 and add a `platforms` option.

## 0.1.1

### Patch Changes

- ce3fde7: Add Arker provider — sandboxed VMs with persistent filesystems, forked from golden images.

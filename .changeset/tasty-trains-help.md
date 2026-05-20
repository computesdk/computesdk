---
"daemond": patch
---

Migrate `daemond` into the ComputeSDK pnpm monorepo under `packages/daemond` while keeping the same npm package name and API.

Add monorepo test/typecheck wiring so `daemond` integration and type checks run in root CI pipelines.

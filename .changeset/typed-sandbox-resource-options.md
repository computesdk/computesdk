---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/isorun": patch
"@computesdk/runloop": patch
---

Add typed `SandboxResourceOptions` to `CreateSandboxOptions`

- Introduce `SandboxResourceOptions` (CPU/memory/disk knobs), `RunloopLaunchParameters`, and `VercelSandboxResources` types, exported from `computesdk` and `@computesdk/provider`.
- `CreateSandboxOptions` now extends `SandboxResourceOptions` and types `runtime`, `image`, `deploymentPlan`, `size`, `vmTier`, `resources`, and `launch_parameters`, so callers can replace `Record<string, any>` resource maps with `Partial<CreateSandboxOptions>` / `SandboxResourceOptions`.
- `@computesdk/isorun`: cast `options.runtime` to the provider `Runtime` type now that the field is typed as `string`.
- `@computesdk/runloop`: destructure `launch_parameters` out of passthrough options and merge it into the devbox `launch_parameters` instead of relying on the spread, fixing a type clash with the Runloop SDK's `LaunchParameters`.

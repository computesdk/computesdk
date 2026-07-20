# @computesdk/isorun

## 0.1.1

### Patch Changes

- f3fe311: Add typed `SandboxResourceOptions` to `CreateSandboxOptions`

  - Introduce `SandboxResourceOptions` (CPU/memory/disk knobs), `RunloopLaunchParameters`, and `VercelSandboxResources` types, exported from `computesdk` and `@computesdk/provider`.
  - `CreateSandboxOptions` now extends `SandboxResourceOptions` and types `runtime`, `image`, `deploymentPlan`, `size`, `vmTier`, `resources`, and `launch_parameters`, so callers can replace `Record<string, any>` resource maps with `Partial<CreateSandboxOptions>` / `SandboxResourceOptions`.
  - `@computesdk/isorun`: cast `options.runtime` to the provider `Runtime` type now that the field is typed as `string`.
  - `@computesdk/runloop`: destructure `launch_parameters` out of passthrough options and merge it into the devbox `launch_parameters` instead of relying on the spread, fixing a type clash with the Runloop SDK's `LaunchParameters`.

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.0

- Initial release. Wraps the `isorun` SDK to expose the ComputeSDK provider interface — isolated Linux VM sandboxes for running untrusted and AI-generated code. Supports `create`, `getById`, `list`, `destroy`, `runCommand`, `getInfo`, `getUrl`, and full filesystem operations.

# @computesdk/tensorlake

## 0.1.7

### Patch Changes

- f4af9af: Update the Tensorlake SDK dependency to 0.5.31.

## 0.1.6

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.1.5

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.1.4

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.1.2

### Patch Changes

- 7c6b99b: Remove hardcoded default image name and resource values when creating Tensorlake sandboxes; let the server choose defaults when options are omitted.

## 0.1.1

### Patch Changes

- e07d46f: Fix `timeout` unit mismatch in the Tensorlake provider. `config.timeout` (passed to `tensorlake({ timeout: ... })`) was being forwarded to the underlying SDK as seconds while `options.timeout` (passed to `compute.sandbox.create({ timeout: ... })`) was correctly treated as milliseconds, contradicting the `TensorlakeConfig` interface comment. Both inputs are now consistently milliseconds and converted to seconds at the SDK boundary, matching the convention used by every other ComputeSDK provider.

## 0.1.0

### Minor Changes

- b4ad62c: Add `@computesdk/tensorlake` provider for stateful MicroVM sandboxes powered by Tensorlake (https://tensorlake.ai), aimed at agentic applications and LLM-generated code execution. Wraps the `tensorlake` SDK and is auto-detected by the `computesdk` gateway via the `TENSORLAKE_API_KEY` environment variable.

## 0.0.1

### Patch Changes

- Initial release of the Tensorlake provider for ComputeSDK

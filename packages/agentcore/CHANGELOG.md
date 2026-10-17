# @computesdk/agentcore

## 0.1.14

### Patch Changes

- Updated dependencies [68f3e19]
- Updated dependencies [51ffdd3]
  - @computesdk/aws@1.0.3

## 0.1.13

### Patch Changes

- df6960f: Deprecate `@computesdk/agentcore`: it is now a thin re-export of `@computesdk/aws/agentcore`. Existing imports keep working; switch to `import { agentcore } from '@computesdk/aws/agentcore'`.
- Updated dependencies [df6960f]
- Updated dependencies [a646a73]
- Updated dependencies [2b6f707]
  - @computesdk/aws@1.0.2

## 0.1.12

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.1.11

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.1.10

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.9

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.8

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.7

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.6

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.5

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.4

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.3

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.2

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.1

### Patch Changes

- 1b4a65c: Add AWS Bedrock AgentCore Code Interpreter provider. Maps a ComputeSDK sandbox onto an AgentCore Code Interpreter session, with command execution and filesystem support. Authenticates via the standard AWS credential provider chain (environment variables, SSO, named profiles, instance roles), so temporary credentials and profiles work out of the box.

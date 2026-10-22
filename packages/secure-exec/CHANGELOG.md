# @computesdk/secure-exec

## 0.1.23

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.22

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.1.21

### Patch Changes

- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.1.20

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.1.19

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.18

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.17

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.16

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.15

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.14

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.13

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.12

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.11

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.10

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.1.9

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.1.8

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

## 0.1.7

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.1.6

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 0.1.5

### Patch Changes

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0

## 0.1.4

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.1.2

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.1.2

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.1.1

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 0.1.1

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

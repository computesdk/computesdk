# @computesdk/aws-ecs

## 1.1.31

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1

## 1.1.30

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0

## 1.1.29

### Patch Changes

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2

## 1.1.28

### Patch Changes

- ca82472: Bump versions to skip burned version numbers from rollback.

## 1.1.27

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1

## 1.1.26

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1

## 1.1.25

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0

## 1.1.24

### Patch Changes

- Updated dependencies [2b30125]
- Updated dependencies [2b30125]
  - computesdk@1.20.0

## 1.1.23

### Patch Changes

- Updated dependencies [68b5296]
  - computesdk@1.19.0

## 1.1.22

### Patch Changes

- Updated dependencies [59147ac]
  - computesdk@1.18.2

## 1.1.21

### Patch Changes

- Updated dependencies [688ca54]
- Updated dependencies [688ca54]
  - computesdk@1.18.1

## 1.1.20

### Patch Changes

- Updated dependencies [128edac]
  - computesdk@1.18.0

## 1.1.19

### Patch Changes

- Updated dependencies [79c9fc5]
  - computesdk@1.17.0

## 1.1.18

### Patch Changes

- Updated dependencies [208a400]
  - computesdk@1.16.0

## 1.1.17

### Patch Changes

- Updated dependencies [25341eb]
  - computesdk@1.15.0

## 1.1.16

### Patch Changes

- Updated dependencies [0c58ba9]
  - computesdk@1.14.0

## 1.1.15

### Patch Changes

- Updated dependencies [3333388]
  - computesdk@1.13.0

## 1.1.14

### Patch Changes

- Updated dependencies [4decff7]
  - computesdk@1.12.1

## 1.1.13

### Patch Changes

- Updated dependencies [fdda069]
  - computesdk@1.12.0

## 1.1.12

### Patch Changes

- Updated dependencies [7c8d968]
  - computesdk@1.11.1

## 1.1.11

### Patch Changes

- Updated dependencies [40d66fc]
  - computesdk@1.11.0

## 1.1.10

### Patch Changes

- computesdk@1.10.3

## 1.1.9

### Patch Changes

- acdc8c6: fix: align provider factory with clean command execution

  Updates all providers to use the new clean command signature introduced in #192.

  **Changes:**

  - Provider factory `runCommand` signature simplified from `(command, args?, options?)` to `(command, options?)`
  - All 13 providers updated to handle `cwd`, `env`, and `background` options by wrapping commands with shell constructs
  - Test suite updated to use clean command strings instead of args arrays

  **Related:**

  - Follows #192 which updated the gateway client to send clean commands
  - Part of the larger refactor to remove client-side command preprocessing

  **Migration:**
  Providers now receive clean command strings and handle options uniformly:

  ```typescript
  // Before
  runCommand(sandbox, "npm", ["install"], { cwd: "/app" });

  // After
  runCommand(sandbox, "npm install", { cwd: "/app" });
  ```

## 1.1.8

### Patch Changes

- Updated dependencies [07e0953]
  - computesdk@1.10.2

## 1.1.7

### Patch Changes

- Updated dependencies [fa18a99]
  - computesdk@1.10.1

## 1.1.6

### Patch Changes

- Updated dependencies [38caad9]
- Updated dependencies [f2d4273]
  - computesdk@1.10.0

## 1.1.5

### Patch Changes

- Updated dependencies [251f324]
  - computesdk@1.9.6

## 1.1.4

### Patch Changes

- Updated dependencies [b027cd9]
  - computesdk@1.9.5

## 1.1.3

### Patch Changes

- computesdk@1.9.4

## 1.1.2

### Patch Changes

- Updated dependencies [f38470d]
- Updated dependencies [f38470d]
  - computesdk@1.9.3

## 1.1.1

### Patch Changes

- Updated dependencies [1ac5ad2]
  - computesdk@1.9.1

## 1.1.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages

### Patch Changes

- Updated dependencies [8002931]
  - computesdk@1.9.0

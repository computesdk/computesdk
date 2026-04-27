# @computesdk/kernel

## 0.2.3

### Patch Changes

- Updated dependencies [371f667]
  - computesdk@3.0.0
  - @computesdk/provider@1.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.2.0

### Minor Changes

- 54fdf0d: Add Kernel browser provider package for cloud browser sessions powered by Kernel:

  - Full session lifecycle: create, retrieve, list, delete, and getConnectUrl via `@onkernel/sdk`
  - Profiles: create, get, list, delete via Kernel REST API
  - Extensions: upload (multipart), get, delete via Kernel REST API
  - Logs: list by consuming SSE stream from `/browsers/{id}/logs/stream`
  - Recordings: start replay via `/browsers/{id}/replays`

# @computesdk/groundbox

## 1.1.0

### Minor Changes

- 8cbd881: Commands in a Groundbox sandbox run as root by default. Pass `user: 'runner'` to `create` for the image's own user, as before.

### Patch Changes

- 09f7b38: Groundbox: `volume.create({ name })` with no size makes a 10 GB volume instead of throwing.
- Updated dependencies [05ed179]
  - computesdk@4.1.24
  - @computesdk/provider@2.1.30

## 1.0.1

### Patch Changes

- 45b8f5b: Add Groundbox provider
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

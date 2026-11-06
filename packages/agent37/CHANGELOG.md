# @computesdk/agent37

## 0.1.4

### Patch Changes

- 6c37daf: Chunk UTF-8 file writes within Agent37's exec request limit and stage each transfer privately in remote TMPDIR before an in-place overwrite, without requiring destination-directory write permission. Preserve existing permissions, hard links and symlink-following behavior. Use flock when available to prevent interleaved concurrent SDK writes; custom images without it retain ordinary redirection behavior.

## 0.1.3

### Patch Changes

- c9718e9: Declare standard sizes: `sizeClass` `md` (2 vCPU / 4 GB) and `lg` (4 vCPU / 8 GB) map onto `resources` on create. `xs`, `sm`, `xl` and `2xl` fail with `unsupported`, since Agent37 only offers 2/4, 4/8, 4/16 and 4/32 shapes with a 4 vCPU ceiling.

## 0.1.2

### Patch Changes

- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 0.1.1

### Patch Changes

- 2cec122: Add Agent37 provider
- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

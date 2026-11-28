# @computesdk/agent37

## 0.1.14

### Patch Changes

- b9a5708: Add standard US regions (`us`, `us-east`, `us-central`, `us-south`, `us-west`) as an opt-in `regionClass` create option (one area or an ordered list; a preference unless `regionMode: 'only'`), with `provider.regions` placement declarations for Vercel, Blaxel, Modal, Daytona, Agent37, Archil, E2B and Styne. The hosted platform provider forwards `regionClass` and `regionMode`.
- Updated dependencies [b9a5708]
  - computesdk@4.1.25
  - @computesdk/provider@2.1.31

## 0.1.13

### Patch Changes

- Updated dependencies [05ed179]
  - computesdk@4.1.24
  - @computesdk/provider@2.1.30

## 0.1.12

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 0.1.11

### Patch Changes

- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 0.1.10

### Patch Changes

- ce6d638: Add `public`/`label` options to `getUrl`: `getUrl({ port, public: true })` returns a permanent, unauthenticated port URL (Agent37 public ports) instead of the provider's ephemeral signed URL. The platform router forwards it via `POST /api/v1/sandboxes/{id}/urls`.
- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 0.1.9

### Patch Changes

- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 0.1.8

### Patch Changes

- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 0.1.7

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 0.1.6

### Patch Changes

- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23
  - computesdk@4.1.17

## 0.1.5

### Patch Changes

- e6d322d: Read large UTF-8 files using bounded exec transfers rather than exceeding Agent37's output limit. Preserve multibyte text across chunk boundaries and reject truncated, malformed, failed, short or detectably changed reads.

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

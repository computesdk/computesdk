# @computesdk/r2

## 1.2.32

### Patch Changes

- a76eb1a: Adapt to the bumped provider SDKs:

  - @computesdk/blaxel: `@blaxel/core` 0.3.41 returns paginated image summaries — tags moved to `listImageTags`, so template listing and build polling page those endpoints instead of reading `spec.tags`.
  - @computesdk/r2, @computesdk/s3: `@tigrisdata/storage` 3.25 added `includeMetadata` `get` overloads — the download call now pins the bare-stream overload so `result.data` stays a `ReadableStream`.

## 1.2.31

### Patch Changes

- d1d9432: Adapt to the bumped provider SDKs:

  - @computesdk/blaxel: `@blaxel/core` 0.3.41 returns paginated image summaries — tags moved to `listImageTags`, so template listing and build polling page those endpoints instead of reading `spec.tags`.
  - @computesdk/r2, @computesdk/s3: `@tigrisdata/storage` 3.25 added `includeMetadata` `get` overloads — the download call now pins the bare-stream overload so `result.data` stays a `ReadableStream`.

- 2ff9301: Bump provider SDKs to their latest npm releases:

  - @computesdk/aws: `@aws-sdk/client-bedrock-agentcore` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/client-ec2` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/client-s3` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/client-ssm` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/types` 3.973.15 -> 3.975.1
  - @computesdk/beam: `@beamcloud/beam-js` ^1.0.22 -> ^1.1.6
  - @computesdk/blaxel: `@blaxel/core` ^0.3.21 -> ^0.3.41
  - @computesdk/boat: `@boatdev/sdk` ^1.9.9 -> ^1.13.0
  - @computesdk/browserbase: `@browserbasehq/sdk` ^2.0.0 -> ^2.29.0
  - @computesdk/browseruse: `browser-use-sdk` ^3.4.3 -> ^3.12.1
  - @computesdk/createos-sandbox: `@nodeops-createos/sandbox` ^0.8.1 -> ^0.8.3
  - @computesdk/freestyle: `freestyle` ^0.2.11 -> ^0.2.24
  - @computesdk/gravixlayer: `gravixlayer` ^0.1.51 -> ^0.1.54
  - @computesdk/isorun: `isorun` ^1.0.0 -> ^1.0.3
  - @computesdk/lightning: `@lightningai/sdk` ^2026.7.8 -> ^2026.11.20
  - @computesdk/miosa: `@miosa/sdk` ^3.7.14 -> ^3.9.0
  - @computesdk/modal: `modal` 0.11.0 -> 0.11.2
  - @computesdk/novita: `novita-sandbox` ^2.1.1 -> ^2.1.5
  - @computesdk/r2: `@tigrisdata/storage` ^3.6.0 -> ^3.25.0
  - @computesdk/railway: `railway` ^3.1.1 -> ^3.17.0
  - @computesdk/render: `@renderinc/sdk` ^1.8.0 -> ^1.10.0
  - @computesdk/s3: `@tigrisdata/storage` ^3.6.0 -> ^3.25.0
  - @computesdk/tangle: `@tangle-network/sandbox` 1.0.501 -> 1.0.588
  - @computesdk/tenki: `@luxorai/sandbox` ^1.5.2 -> ^1.5.3
  - @computesdk/tensorlake: `tensorlake` ^0.5.158 -> ^0.5.165
  - @computesdk/tigris: `@tigrisdata/storage` ^3.6.0 -> ^3.25.0
  - @computesdk/vercel: `@vercel/sandbox` ^4.0.0 -> ^4.1.0
  - @computesdk/provider@2.1.30

## 1.2.30

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - @computesdk/provider@2.1.29

## 1.2.29

### Patch Changes

- Updated dependencies [eaec2cd]
  - @computesdk/provider@2.1.28

## 1.2.28

### Patch Changes

- @computesdk/provider@2.1.27

## 1.2.27

### Patch Changes

- @computesdk/provider@2.1.26

## 1.2.26

### Patch Changes

- Updated dependencies [1fc7e73]
  - @computesdk/provider@2.1.25

## 1.2.25

### Patch Changes

- 1fb3804: Raise the minimum supported Node.js version to 22 (root development floor 22.19.0); Node.js 18 and 20 are EOL.
  - @computesdk/provider@2.1.24

## 1.2.24

### Patch Changes

- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23

## 1.2.23

### Patch Changes

- 1904e82: `list()` reads the storage SDK's `items`/`hasMore`/`paginationToken` response, so listed objects, truncation and continuation tokens are no longer dropped.
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22

## 1.2.22

### Patch Changes

- Updated dependencies [24803d6]
  - @computesdk/provider@2.1.21

## 1.2.21

### Patch Changes

- Updated dependencies [2bd2e7d]
  - @computesdk/provider@2.1.20

## 1.2.20

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 1.2.19

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 1.2.18

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 1.2.17

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 1.2.16

### Patch Changes

- Updated dependencies [1b639da]
  - @computesdk/provider@2.1.15

## 1.2.15

### Patch Changes

- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14

## 1.2.14

### Patch Changes

- Updated dependencies [aadc200]
  - @computesdk/provider@2.1.13

## 1.2.13

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.2.12

### Patch Changes

- Updated dependencies [7240d21]
  - @computesdk/provider@2.1.11

## 1.2.11

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10

## 1.2.10

### Patch Changes

- @computesdk/provider@2.1.9

## 1.2.9

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8

## 1.2.8

### Patch Changes

- @computesdk/provider@2.1.7

## 1.2.7

### Patch Changes

- @computesdk/provider@2.1.6

## 1.2.6

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 1.2.5

### Patch Changes

- Updated dependencies [f3fe311]
  - @computesdk/provider@2.1.4

## 1.2.4

### Patch Changes

- @computesdk/provider@2.1.3

## 1.2.3

### Patch Changes

- @computesdk/provider@2.1.2

## 1.2.2

### Patch Changes

- Updated dependencies [eca5ec2]
  - @computesdk/provider@2.1.1

## 1.2.1

### Patch Changes

- Updated dependencies [cc79d78]
  - @computesdk/provider@2.1.0

## 1.2.0

### Minor Changes

- d65c97b: Migrate S3 and R2 providers from direct AWS SDK usage to `@tigrisdata/storage`, including per-call config forwarding and improved object metadata handling on downloads.

  Align Tigris storage dependency usage across providers and include a BrowserUse typing fix for custom proxy configuration.

## 1.1.5

### Patch Changes

- Updated dependencies [aa4ca58]
  - @computesdk/provider@2.0.0

## 1.1.4

### Patch Changes

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0

## 1.1.3

### Patch Changes

- Updated dependencies [a321f01]
  - @computesdk/provider@1.3.0

## 1.1.2

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 1.1.1

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0

## 1.1.1

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0

## 1.1.1

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0

## 1.1.0

### Minor Changes

- 45f918b: Add object storage providers for S3, R2, and Tigris with a unified storage provider test suite

### Patch Changes

- @computesdk/provider@1.0.33

## 1.1.0

### Minor Changes

- 0b97465: Add object storage providers for S3, R2, and Tigris with a unified storage provider test suite

### Patch Changes

- @computesdk/provider@1.0.33

## 1.1.0

### Minor Changes

- b1d5204: Add object storage providers for S3, R2, and Tigris with a unified storage provider test suite

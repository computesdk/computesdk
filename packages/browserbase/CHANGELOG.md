# @computesdk/browserbase

## 0.3.2

### Patch Changes

- Updated dependencies [6a79b9b]
  - computesdk@3.0.0
  - @computesdk/provider@2.0.0

## 0.3.1

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.3.0

### Minor Changes

- 3e6a91a: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- 3e6a91a: Fix file type mismatch in @computesdk/browserbase package.json

  - Correct `main` to point to `./dist/index.cjs` (CommonJS) instead of `./dist/index.js`
  - Correct `module` to point to `./dist/index.js` (ESM) instead of `./dist/index.mjs`
  - Update `exports` map to match the corrected entry points

- 9a2eab9: Bump @computesdk/browserbase to 0.2.1
- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.0

### Minor Changes

- 9a312d2: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- 9a312d2: Fix file type mismatch in @computesdk/browserbase package.json

  - Correct `main` to point to `./dist/index.cjs` (CommonJS) instead of `./dist/index.js`
  - Correct `module` to point to `./dist/index.js` (ESM) instead of `./dist/index.mjs`
  - Update `exports` map to match the corrected entry points

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.0

### Minor Changes

- b34d97f: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

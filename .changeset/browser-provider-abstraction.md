---
"@computesdk/provider": minor
"@computesdk/browserbase": minor
"computesdk": patch
"@computesdk/test-utils": patch
---

Add browser provider abstraction and Browserbase provider

- Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
- Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
- Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
- Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

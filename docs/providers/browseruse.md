# Browser Use

The `@computesdk/browseruse` adapter controls Browser Use Cloud browser sessions. It exposes browser session, profile, proxy and recording APIs, rather than the sandbox instance interface used by the Platform SDK.

```bash
npm install @computesdk/browseruse playwright-core
export BROWSER_USE_API_KEY="your_browser_use_api_key"
```

Follow the [package quickstart](https://github.com/computesdk/computesdk/tree/main/packages/browseruse#quick-start) to create a session, connect Playwright over CDP and clean up. See the [runnable example](https://github.com/computesdk/computesdk/blob/main/packages/browseruse/example-browseruse.ts) for the complete adapter workflow.

Browser sessions require Browser Use credentials and are billed under that provider account. Installing this direct adapter does not configure a hosted ComputeSDK route.

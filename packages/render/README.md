# @computesdk/render

> **Deprecated.** This package is no longer functional.

Render support previously depended on the hosted control-plane transport, which was removed from `computesdk` in v3.0.0. Importing and calling `render()` now throws a migration error.

## Migrating

Use one of the supported direct provider packages instead:

- [@computesdk/e2b](https://www.npmjs.com/package/@computesdk/e2b)
- [@computesdk/modal](https://www.npmjs.com/package/@computesdk/modal)
- [@computesdk/vercel](https://www.npmjs.com/package/@computesdk/vercel)
- [@computesdk/daytona](https://www.npmjs.com/package/@computesdk/daytona)

See the [ComputeSDK getting-started guide](https://github.com/computesdk/computesdk/tree/main/docs/getting-started) for direct-mode setup.

## License

MIT

#!/usr/bin/env node
/**
 * ComputeSDK Cloudflare Setup CLI
 *
 * Prints instructions for configuring remote mode with the official Cloudflare
 * Sandbox bridge Worker URL and API key.
 */

console.log(`
  ComputeSDK Cloudflare Setup

  1. Deploy the official bridge Worker:

     https://developers.cloudflare.com/sandbox/bridge/

  2. Set the bridge Worker's API key secret:

     npx wrangler secret put SANDBOX_API_KEY

  3. Configure your app with the bridge URL and the same API key:

     CLOUDFLARE_SANDBOX_URL=https://<your-bridge-subdomain>.workers.dev
     CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>

  4. Use it with ComputeSDK:

     import { cloudflare } from '@computesdk/cloudflare';

     const compute = cloudflare({
       sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
       sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
     });

  Warm pool support is configured on the bridge Worker. Set WARM_POOL_TARGET to
  a positive value, for example WARM_POOL_TARGET=10, to keep sandboxes warm.
`);

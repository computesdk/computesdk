#!/usr/bin/env node
/**
 * ComputeSDK Cloudflare Setup CLI
 *
 * Prints instructions for configuring remote mode with the Cloudflare sandbox
 * demo Worker URL and API key.
 */

console.log(`
  ComputeSDK Cloudflare Setup

  1. Deploy the Cloudflare sandbox demo Worker:

     https://github.com/cloudflare/containers-demos/tree/main/sandbox

  2. Set the Worker's API key secret:

     npx wrangler secret put SANDBOX_API_KEY

  3. Configure your app with the Worker URL and the same API key:

     CLOUDFLARE_SANDBOX_URL=https://sandbox.<your-subdomain>.workers.dev
     CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>

  4. Use it with ComputeSDK:

     import { cloudflare } from '@computesdk/cloudflare';

     const compute = cloudflare({
       sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
       sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
     });
`);

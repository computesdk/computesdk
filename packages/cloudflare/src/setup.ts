#!/usr/bin/env node
/**
 * ComputeSDK Cloudflare Setup CLI
 *
 * Prints instructions for deploying the ComputeSDK bridge Worker and
 * configuring remote mode with its URL and API key.
 */

console.log(`
  ComputeSDK Cloudflare Setup

  Requirements: a Cloudflare account on the Workers Paid plan (Containers),
  Node.js, and Docker running locally (Wrangler builds the container images and
  pushes them to Cloudflare's registry during deploy).

  1. Get the bridge Worker from the ComputeSDK repository:

     git clone https://github.com/computesdk/computesdk.git
     cd computesdk/packages/cloudflare/worker
     npm ci

  2. Log in, set the Worker's API key secret, and deploy:

     npx wrangler login
     openssl rand -hex 32   # use the output as the API key
     npx wrangler secret put SANDBOX_API_KEY
     npx wrangler deploy

  3. Configure your app with the Worker URL and the same API key:

     CLOUDFLARE_SANDBOX_URL=https://sandbox.<your-subdomain>.workers.dev
     CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>

  4. Use it with ComputeSDK:

     import { cloudflare } from '@computesdk/cloudflare';

     const compute = cloudflare({
       sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
       sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
     });

  A Worker deployed from the Cloudflare sandbox demo keeps working for
  commands and files; snapshots and preview URLs need the bridge Worker.
`);

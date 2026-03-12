/**
 * ComputeSDK Cloudflare Setup CLI
 *
 * Deploys a gateway Worker to the user's Cloudflare account that proxies
 * sandbox operations to a Durable Object. After deployment, outputs the
 * environment variables needed to use the Cloudflare provider.
 *
 * Usage:
 *   npx @computesdk/cloudflare
 *
 * Prerequisites:
 *   CLOUDFLARE_API_TOKEN  - API token with Workers Scripts permissions
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID
 */

import { execSync } from 'child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';

// Load .env files from common locations (no external deps needed)
function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override existing env vars
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Try .env in cwd, then parent dirs up to 3 levels
const cwd = process.cwd();
loadEnvFile(join(cwd, '.env'));
loadEnvFile(resolve(cwd, '..', '.env'));
loadEnvFile(resolve(cwd, '..', '..', '.env'));

const WORKER_NAME = 'computesdk-sandbox';

async function setup() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  console.log('\n  ComputeSDK Cloudflare Setup\n');

  // 1. Check prerequisites
  if (!apiToken || !accountId) {
    console.error('  Missing required environment variables:\n');
    if (!apiToken) console.error('    CLOUDFLARE_API_TOKEN');
    if (!accountId) console.error('    CLOUDFLARE_ACCOUNT_ID');
    console.error('\n  Set these before running setup.');
    console.error('  Get your API token at: https://dash.cloudflare.com/profile/api-tokens\n');
    process.exit(1);
  }

  // 2. Verify token works
  console.log('  Verifying Cloudflare credentials...');
  const verifyRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}`,
    { headers: { 'Authorization': `Bearer ${apiToken}` } }
  );

  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    console.error(`  Invalid credentials (HTTP ${verifyRes.status}): ${body}`);
    console.error('  Check your CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.\n');
    process.exit(1);
  }

  // 3. Check Docker is installed (required for building the container image)
  try {
    execSync('which docker', { stdio: 'pipe' });
  } catch {
    console.error('  Docker is required but not found.');
    console.error('  Wrangler needs Docker to build the sandbox container image.');
    console.error('  Install Docker Desktop: https://www.docker.com/products/docker-desktop\n');
    process.exit(1);
  }

  // 4. Generate secret for Worker auth
  const secret = randomBytes(32).toString('hex');

  // 5. Copy Worker source to temp directory
  // Script is at dist/setup.mjs, worker source is at src/worker/
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const workerSrc = join(packageRoot, 'src', 'worker');
  const tmpDir = mkdtempSync(join(tmpdir(), 'computesdk-cf-'));
  cpSync(workerSrc, tmpDir, { recursive: true });

  // 6. Install Worker dependencies
  console.log('  Installing Worker dependencies...');
  try {
    execSync('npm install --production', { cwd: tmpDir, stdio: 'pipe' });
  } catch {
    console.error('  Failed to install dependencies. Ensure npm is available.');
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // 7. Deploy with wrangler
  console.log(`  Deploying ${WORKER_NAME} to your account...`);
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };

  try {
    execSync(`npx wrangler deploy --name ${WORKER_NAME}`, {
      cwd: tmpDir,
      stdio: 'inherit',
      env,
    });
  } catch {
    console.error('\n  Deploy failed.');
    console.error('  Ensure your API token has Workers Scripts:Edit permission.');
    console.error('  Create a token at: https://dash.cloudflare.com/profile/api-tokens\n');
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // 8. Set the secret
  console.log('  Setting SANDBOX_SECRET...');
  try {
    execSync(
      `npx wrangler secret put SANDBOX_SECRET --name ${WORKER_NAME}`,
      { cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'], env, input: `${secret}\n` }
    );
  } catch {
    console.error('\n  Failed to set Worker secret.');
    console.error('  You can set it manually: npx wrangler secret put SANDBOX_SECRET --name computesdk-sandbox\n');
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // 9. Get the Worker URL
  const subdomain = await getWorkersSubdomain(apiToken, accountId);
  const workerUrl = `https://${WORKER_NAME}.${subdomain}.workers.dev`;

  // 10. Verify deployment
  console.log('  Verifying deployment...');
  try {
    const healthRes = await fetch(`${workerUrl}/v1/health`);
    if (!healthRes.ok) {
      console.warn(`  Warning: Health check returned HTTP ${healthRes.status}.`);
    } else {
      let health: any;
      try {
        health = await healthRes.json();
      } catch {
        const text = await healthRes.text().catch(() => '(unreadable)');
        console.warn(`  Warning: Health check returned non-JSON response: ${text.slice(0, 200)}`);
      }
      if (health && health.status !== 'ok') {
        console.warn('  Warning: Health check returned unexpected response.');
      }
    }
  } catch {
    console.warn('  Warning: Could not reach Worker. It may take a moment to propagate.');
  }

  // 11. Clean up temp directory
  rmSync(tmpDir, { recursive: true, force: true });

  // 12. Output results
  console.log('\n  Setup complete! Add these to your .env:\n');
  console.log(`  CLOUDFLARE_SANDBOX_URL=${workerUrl}`);
  console.log(`  CLOUDFLARE_SANDBOX_SECRET=${secret}`);
  console.log('');
  console.log('  Then use it with ComputeSDK:\n');
  console.log("    import { compute } from 'computesdk';");
  console.log('    const sandbox = await compute.sandbox.create();');
  console.log("    await sandbox.runCode('print(\"hello\")');\n");
}

async function getWorkersSubdomain(token: string, accountId: string): Promise<string> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!res.ok) {
    // Fall back to account ID if subdomain lookup fails
    console.warn('  Warning: Could not determine Workers subdomain. Using account ID.');
    return accountId;
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    console.warn('  Warning: Workers subdomain API returned non-JSON response. Using account ID.');
    return accountId;
  }
  return data.result?.subdomain || accountId;
}

// Run
setup().catch((err) => {
  console.error(`\n  Unexpected error: ${err.message}\n`);
  process.exit(1);
});

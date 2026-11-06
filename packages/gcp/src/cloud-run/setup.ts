/** ComputeSDK Cloud Run setup CLI. */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
}

const cwd = process.cwd()
loadEnvFile(join(cwd, '.env'))
loadEnvFile(resolve(cwd, '..', '.env'))
loadEnvFile(resolve(cwd, '..', '..', '.env'))

function run(command: string, args: string[], options: { cwd?: string; input?: string; stdio?: 'pipe' | 'inherit' } = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8',
    env: process.env,
  })
}

async function setup() {
  const projectId = process.env.CLOUD_RUN_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.PROJECT_ID
  const region = process.env.CLOUD_RUN_REGION ?? process.env.GOOGLE_CLOUD_LOCATION ?? process.env.REGION
  const serviceName = process.env.CLOUD_RUN_SERVICE_NAME ?? 'computesdk-sandbox'
  // Optional GCS bucket for `sandbox tar` snapshots; without it snapshots stay
  // on the gateway instance that took them.
  const snapshotBucket = process.env.CLOUD_RUN_SNAPSHOT_BUCKET?.replace(/^gs:\/\//, '').replace(/\/$/, '')
  const serviceAccount = process.env.CLOUD_RUN_SERVICE_ACCOUNT
  // Stateful sandboxes live on one instance and follow-up calls reach it via
  // session affinity, which needs spare request slots on that instance.
  const concurrency = process.env.CLOUD_RUN_CONCURRENCY ?? '20'
  const minInstances = process.env.CLOUD_RUN_MIN_INSTANCES ?? '100'
  const maxInstances = process.env.CLOUD_RUN_MAX_INSTANCES ?? '100'
  const idleTimeout = process.env.CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS

  console.log('\n  ComputeSDK Cloud Run Setup\n')

  if (!projectId || !region) {
    console.error('  Missing required environment variables:\n')
    if (!projectId) console.error('    CLOUD_RUN_PROJECT_ID or GOOGLE_CLOUD_PROJECT or PROJECT_ID')
    if (!region) console.error('    CLOUD_RUN_REGION or GOOGLE_CLOUD_LOCATION or REGION')
    console.error('\n  Your GCP project must also be allow-listed for Cloud Run Sandboxes.\n')
    process.exit(1)
  }

  try {
    run('gcloud', ['--version'])
  } catch {
    console.error('  gcloud is required for setup but was not found.')
    console.error('  Install the Google Cloud CLI, run `gcloud components update`, and authenticate.\n')
    process.exit(1)
  }

  // Redeploying with the current secret keeps existing clients working.
  const reusedSecret = process.env.CLOUD_RUN_SANDBOX_SECRET
  const secret = reusedSecret || randomBytes(32).toString('hex')
  const distDir = dirname(realpathSync(fileURLToPath(import.meta.url)))
  const gatewayPath = join(distDir, 'gateway.mjs')
  const tmpDir = mkdtempSync(join(tmpdir(), 'computesdk-cloud-run-'))
  const image = `gcr.io/${projectId}/${serviceName}:latest`

  try {
    copyFileSync(gatewayPath, join(tmpDir, 'gateway.mjs'))
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ type: 'module', scripts: { start: 'node gateway.mjs' } }, null, 2))
    writeFileSync(join(tmpDir, 'Dockerfile'), [
      'FROM node:22-slim',
      // The sandbox CLI verifies TLS against system CAs (e.g. for gs:// snapshots).
      'RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*',
      'WORKDIR /app',
      'COPY package.json gateway.mjs ./',
      'ENV NODE_ENV=production',
      'CMD ["node", "gateway.mjs"]',
      '',
    ].join('\n'))

    if (snapshotBucket) {
      try {
        run('gcloud', ['storage', 'buckets', 'describe', `gs://${snapshotBucket}`, '--project', projectId])
      } catch {
        console.log(`  Creating snapshot bucket gs://${snapshotBucket}...`)
        run('gcloud', ['storage', 'buckets', 'create', `gs://${snapshotBucket}`, '--project', projectId, '--location', region, '--uniform-bucket-level-access'], { stdio: 'inherit' })
      }
      const member = serviceAccount ?? `${run('gcloud', ['projects', 'describe', projectId, '--format', 'value(projectNumber)']).trim()}-compute@developer.gserviceaccount.com`
      console.log(`  Granting ${member} roles/storage.objectAdmin on gs://${snapshotBucket}...`)
      run('gcloud', ['storage', 'buckets', 'add-iam-policy-binding', `gs://${snapshotBucket}`, '--member', `serviceAccount:${member}`, '--role', 'roles/storage.objectAdmin', '--project', projectId], { stdio: 'inherit' })
    }

    console.log(`  Building gateway image ${image}...`)
    run('gcloud', ['builds', 'submit', '--tag', image, '--project', projectId], { cwd: tmpDir, stdio: 'inherit' })

    console.log(`  Deploying ${serviceName} with --sandbox-launcher...`)
    run('gcloud', [
      'beta', 'run', 'deploy', serviceName,
      '--image', image,
      '--region', region,
      '--project', projectId,
      '--sandbox-launcher',
      '--allow-unauthenticated',
      '--cpu', '1',
      '--memory', '2Gi',
      '--concurrency', concurrency,
      '--min-instances', minInstances,
      '--max-instances', maxInstances,
      '--session-affinity',
      '--cpu-boost',
      '--no-cpu-throttling',
      ...(serviceAccount ? ['--service-account', serviceAccount] : []),
      '--set-env-vars', [`SANDBOX_SECRET=${secret}`, ...(snapshotBucket ? [`CLOUD_RUN_SNAPSHOT_BUCKET=${snapshotBucket}`] : []), ...(idleTimeout ? [`CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS=${idleTimeout}`] : [])].join(','),
    ], { stdio: 'inherit' })

    // A pinned traffic split keeps serving the old revision after deploy.
    run('gcloud', ['run', 'services', 'update-traffic', serviceName, '--to-latest', '--region', region, '--project', projectId], { stdio: 'inherit' })

    const serviceUrl = run('gcloud', [
      'run', 'services', 'describe', serviceName,
      '--region', region,
      '--project', projectId,
      '--format', 'value(status.url)',
    ]).trim()

    console.log('\n  Setup complete! Add these to your .env:\n')
    console.log(`  CLOUD_RUN_SANDBOX_URL=${serviceUrl}`)
    console.log(reusedSecret ? '  CLOUD_RUN_SANDBOX_SECRET is unchanged' : `  CLOUD_RUN_SANDBOX_SECRET=${secret}`)
    console.log('')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

setup().catch(error => {
  console.error(`\n  Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})

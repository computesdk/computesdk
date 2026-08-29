import { describe, expect, it } from 'vitest'
import { cloudRun } from '../index'

const sandboxUrl = process.env.CLOUD_RUN_SANDBOX_URL
const sandboxSecret = process.env.CLOUD_RUN_SANDBOX_SECRET
const hasGatewayCredentials = !!(sandboxUrl && sandboxSecret)

describe.runIf(hasGatewayCredentials)('cloudRun credentialed smoke test', () => {
  it('creates a remote sandbox, runs node, and destroys it', async () => {
    const compute = cloudRun({
      sandboxUrl,
      sandboxSecret,
      gatewayAuthToken: process.env.CLOUD_RUN_AUTH_TOKEN,
    })

    const sandbox = await compute.sandbox.create({ envs: { COMPUTESDK_SMOKE: 'true' } })

    try {
      const nodeVersion = await sandbox.runCommand('node -v')
      expect(nodeVersion.exitCode).toBe(0)
      expect(nodeVersion.stderr).toBe('')
      expect(nodeVersion.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+$/)
    } finally {
      await sandbox.destroy()
    }
  }, 30_000)
})

describe.skipIf(hasGatewayCredentials)('cloudRun credentialed smoke test', () => {
  it('requires CLOUD_RUN_SANDBOX_URL and CLOUD_RUN_SANDBOX_SECRET', () => {
    expect(hasGatewayCredentials).toBe(false)
  })
})

import { describe, it } from 'vitest'
import { runProviderTestSuite } from '@computesdk/test-utils'
import { cloudRun } from '../index'
import { withExpectedSnapshotCapabilities } from './helpers/snapshot-capabilities'

const sandboxUrl = process.env.CLOUD_RUN_SANDBOX_URL?.replace(/\/$/, '')
const sandboxSecret = process.env.CLOUD_RUN_SANDBOX_SECRET
const gatewayAuthToken = process.env.CLOUD_RUN_AUTH_TOKEN

// Gateways deployed before stateful sandboxes advertise no features; the full
// suite needs state to persist between calls, so it only runs against one that does.
const features: string[] = sandboxUrl && sandboxSecret
  ? await fetch(`${sandboxUrl}/v1/health`, { headers: gatewayAuthToken ? { Authorization: `Bearer ${gatewayAuthToken}` } : {} })
    .then(res => res.json())
    .then((data: { features?: string[] }) => data.features ?? [])
    .catch(() => [])
  : []

if (features.includes('stateful')) {
  runProviderTestSuite({
    name: 'cloud-run',
    provider: features.includes('snapshot')
      ? withExpectedSnapshotCapabilities(cloudRun({ sandboxUrl, sandboxSecret, gatewayAuthToken, executionMode: 'stateful' }))
      : cloudRun({ sandboxUrl, sandboxSecret, gatewayAuthToken, executionMode: 'stateful' }),
    supportsFilesystem: true,
    supportsGetUrl: false,
    supportsStreaming: true,
    supportsProcesses: true,
    supportsSnapshots: features.includes('snapshot'),
    expectProcessRuntime: { streaming: 'native', processes: 'shell' },
    timeout: 120_000,
  })
} else {
  describe('cloud-run live conformance', () => {
    it.skip('needs a gateway that advertises stateful sandboxes on /v1/health', () => {})
  })
}

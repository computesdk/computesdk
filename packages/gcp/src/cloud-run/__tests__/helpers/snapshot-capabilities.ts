import type { SnapshotCapabilities } from 'computesdk'

/**
 * What Cloud Run snapshots are expected to keep, per the sandbox CLI reference.
 * The provider leaves `snapshot.capabilities` undeclared until a deployed
 * gateway proves them; tests that can exercise snapshots declare them here.
 */
export const EXPECTED_SNAPSHOT_CAPABILITIES: SnapshotCapabilities = {
  scope: 'rootfs',
  memory: false,
  destroysSource: false,
  source: 'kept',
  excludes: ['/tmp'],
  fork: true,
  createOptions: { ephemeral: false },
}

export function withExpectedSnapshotCapabilities<T extends { snapshot?: object }>(provider: T): T {
  Object.assign(provider.snapshot!, { capabilities: EXPECTED_SNAPSHOT_CAPABILITIES })
  return provider
}

/**
 * Snapshots — filesystem images of a sandbox that a new sandbox can boot from.
 *
 * Buddy creates them asynchronously: the create call returns `status: CREATING`
 * and the snapshot cannot be restored until it turns `CREATED`. The provider
 * waits for that here so callers get a snapshot they can actually use. The
 * wait uses a 500 ms poll rather than the SDK entity's 2 s one, because typical
 * snapshots settle in well under a second.
 */

import type { CreateSnapshotOptions, ListSnapshotsOptions } from '@computesdk/provider';
import type { Snapshot } from 'computesdk';

import {
  PROVIDER,
  getClient,
  isNotFound,
  sleep,
  toIdentifier,
  type ResolvedBuddyConfig,
} from './utils.js';

const SNAPSHOT_WAIT_TIMEOUT_MS = 180_000;
const SNAPSHOT_WAIT_POLL_MS = 500;

interface BuddySnapshotData {
  id?: string;
  name?: string;
  size?: number;
  status?: string;
  create_date?: Date | string;
}

function toSnapshot(data: BuddySnapshotData, sandboxId?: string): Snapshot {
  if (!data.id) {
    throw new Error('Buddy API returned a snapshot without an id.');
  }
  return {
    id: data.id,
    provider: PROVIDER,
    createdAt: data.create_date ? new Date(data.create_date) : new Date(),
    metadata: {
      name: data.name,
      status: data.status,
      sizeGb: data.size,
      ...(sandboxId ? { sandboxId } : {}),
    },
  };
}

export async function createSnapshot(
  config: ResolvedBuddyConfig,
  sandboxId: string,
  options: CreateSnapshotOptions = {},
): Promise<Snapshot> {
  const client = getClient(config);
  const created = await client.addSandboxSnapshot({
    path: { sandbox_id: sandboxId },
    body: { name: toIdentifier(options.name ?? `computesdk-${Date.now()}`) },
  });

  const snapshotId = created.id;
  if (!snapshotId) {
    throw new Error('Buddy accepted the snapshot but returned no snapshot id.');
  }

  const ready = await waitUntilCreated(config, sandboxId, snapshotId, created);
  return toSnapshot(ready, sandboxId);
}

async function waitUntilCreated(
  config: ResolvedBuddyConfig,
  sandboxId: string,
  snapshotId: string,
  initial: BuddySnapshotData,
): Promise<BuddySnapshotData> {
  if (initial.status === 'CREATED') return initial;

  const client = getClient(config);
  const deadline = Date.now() + SNAPSHOT_WAIT_TIMEOUT_MS;
  for (;;) {
    const data = await client.getSandboxSnapshot({
      path: { sandbox_id: sandboxId, id: snapshotId },
    }) as BuddySnapshotData;

    if (data.status === 'CREATED') return data;
    if (data.status === 'FAILED') {
      throw new Error(`Buddy snapshot ${snapshotId} failed to be created.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Buddy snapshot ${snapshotId} was still ${data.status} after ` +
        `${SNAPSHOT_WAIT_TIMEOUT_MS / 1000}s.`,
      );
    }
    await sleep(SNAPSHOT_WAIT_POLL_MS);
  }
}

export async function listSnapshots(
  config: ResolvedBuddyConfig,
  options: ListSnapshotsOptions = {},
): Promise<Snapshot[]> {
  const client = getClient(config);
  // Default to the project-wide listing: snapshots outlive the sandbox they were
  // taken from, so the per-sandbox endpoint would hide most of them.
  const response = options.sandboxId
    ? await client.getSandboxSnapshots({ path: { sandbox_id: options.sandboxId } })
    : await client.getProjectSnapshots({});

  const snapshots = (response.snapshots ?? [])
    .map(snapshot => toSnapshot(snapshot as BuddySnapshotData, options.sandboxId));
  return options.limit ? snapshots.slice(0, options.limit) : snapshots;
}

export async function deleteSnapshot(
  config: ResolvedBuddyConfig,
  snapshotId: string,
): Promise<void> {
  try {
    await getClient(config).deleteSnapshot({ path: { id: snapshotId } });
  } catch (error) {
    // Deleting an already-deleted snapshot is the state the caller wanted.
    if (!isNotFound(error)) throw error;
  }
}

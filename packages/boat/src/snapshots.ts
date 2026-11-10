import { randomUUID } from 'node:crypto';
import type { BoatApi, NamedSnapshot } from '@boatdev/sdk';
import type { CreateSnapshotOptions, ListSnapshotsOptions } from '@computesdk/provider';
import type { BoatConfig } from './index';

export interface BoatSnapshot extends NamedSnapshot {
  /** Reusable snapshot name; the native snapshotId is a different, non-bootable artifact ID. */
  id: string;
  provider: 'boat';
}
export interface BoatTemplate extends BoatSnapshot { templateId: string }

export function snapshotInfo(snapshot: NamedSnapshot): BoatSnapshot {
  return { ...snapshot, id: snapshot.name, provider: 'boat' };
}
export function templateInfo(snapshot: BoatSnapshot): BoatTemplate {
  return { ...snapshot, templateId: snapshot.name };
}

export async function saveSnapshot(api: BoatApi, config: BoatConfig, sandboxId: string, options?: CreateSnapshotOptions): Promise<BoatSnapshot> {
  if (options?.metadata !== undefined) throw new Error('Boat named snapshots do not support arbitrary metadata.');
  const name = options?.name ?? `compute-${randomUUID()}`;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name) || ['latest', 'tree', 'pull', 'rm', 'save', 'current', 'self', 'new'].includes(name)) {
    throw new Error('Boat snapshot names must be 1-63 lowercase letters, digits, or dashes, start with a letter or digit, and not be reserved.');
  }
  const timeout = config.snapshotTimeout ?? 600_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Boat snapshotTimeout must be positive milliseconds.');
  const deadline = Date.now() + timeout;
  let snapshot = (await api.saveNamedSnapshot({ namedSnapshotSaveRequest: { sandboxId, name } })).snapshot;
  while (snapshot.status !== 'ready') {
    if (snapshot.status === 'failed') throw new Error(`Boat snapshot ${name} failed: ${snapshot.error ?? 'unknown error'}`);
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for Boat snapshot ${name}; inspect or delete it through the snapshot manager.`);
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))));
    snapshot = (await api.getNamedSnapshot({ name })).snapshot;
  }
  return snapshotInfo(snapshot);
}

export function limitItems<T>(items: T[], limit?: number): T[] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw new Error('Boat list limit must be a non-negative integer.');
  return limit === undefined ? items : items.slice(0, limit);
}

export async function listSnapshots(api: BoatApi, options?: ListSnapshotsOptions): Promise<BoatSnapshot[]> {
  limitItems([], options?.limit);
  if (options?.limit === 0) return [];
  const sandboxId = options?.instanceId ?? options?.sandboxId;
  return limitItems((await api.listNamedSnapshots()).snapshots
    .filter(snapshot => sandboxId === undefined || snapshot.sourceSandboxId === sandboxId)
    .map(snapshotInfo), options?.limit);
}

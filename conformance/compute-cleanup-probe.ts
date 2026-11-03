/** Public SDK surface only; neither native handles nor mutation are needed. */
export interface CleanupSandbox {
  readonly sandboxId: string;
  getInfo(): Promise<unknown>;
}

export interface CleanupManager {
  getById(id: string): Promise<CleanupSandbox | null>;
}

export interface CleanupProbeOptions {
  profileId?: string;
  oracle?: 'sdk-absence' | 'createos-destroyed-metadata' | 'blaxel-terminated-metadata';
}

export type CleanupObservation =
  | { kind: 'sdk-absent' }
  | { kind: 'present' }
  | {
    kind: 'native-terminal';
    oracle: 'createos-destroyed-metadata';
    status: 'destroyed';
  }
  | {
    kind: 'native-terminal';
    oracle: 'blaxel-terminated-metadata';
    status: 'TERMINATED';
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One public SDK getById per probe; no create/destroy/native access.
 * CreateOS getInfo refreshes metadata through a second public SDK read.
 * Only the reviewed profile/oracle pair may use its exact terminal metadata.
 * SDK errors propagate for the caller's bounded, sanitizing deadline.
 * Observations contain no SDK objects, IDs, native payloads or raw errors.
 * Neither outcome proves physical deletion or cessation of billing.
 */
export async function probeCleanup(
  manager: CleanupManager,
  ownedId: string,
  options: CleanupProbeOptions = {},
): Promise<CleanupObservation> {
  if (typeof ownedId !== 'string' || ownedId.length === 0) {
    throw new Error('Cleanup probe requires an owned SDK ID');
  }
  const found = await manager.getById(ownedId);
  if (found === null) return { kind: 'sdk-absent' };
  if (!isRecord(found) || found.sandboxId !== ownedId) {
    throw new Error('Cleanup lookup did not return the owned SDK ID');
  }
  const terminal = options.profileId === '@computesdk/createos-sandbox' &&
    options.oracle === 'createos-destroyed-metadata'
    ? {
      field: 'createosStatus', status: 'destroyed',
      observation: { kind: 'native-terminal', oracle: 'createos-destroyed-metadata', status: 'destroyed' },
    } as const
    : options.profileId === '@computesdk/blaxel' && options.oracle === 'blaxel-terminated-metadata'
      ? {
        field: 'blaxelStatus', status: 'TERMINATED',
        observation: { kind: 'native-terminal', oracle: 'blaxel-terminated-metadata', status: 'TERMINATED' },
      } as const
      : undefined;
  if (!terminal) return { kind: 'present' };
  if (typeof found.getInfo !== 'function') {
    throw new Error('Cleanup lookup did not return a public SDK info method');
  }
  const info: unknown = await found.getInfo();
  if (!isRecord(info) || info.id !== ownedId ||
      (info.metadata !== undefined && !isRecord(info.metadata))) {
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  const status: unknown = info.metadata?.[terminal.field];
  if (status !== undefined && typeof status !== 'string') {
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  return status === terminal.status
    ? terminal.observation
    : { kind: 'present' };
}

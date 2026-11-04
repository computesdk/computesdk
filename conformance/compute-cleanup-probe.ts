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
  oracle?: 'sdk-absence' | 'createos-destroyed-metadata' | 'blaxel-terminated-metadata'
    | 'modal-finished-exitcode' | 'upstash-deleted-metadata';
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
  }
  | {
    kind: 'native-terminal';
    oracle: 'modal-finished-exitcode';
    status: number;
  }
  | {
    kind: 'native-terminal';
    oracle: 'upstash-deleted-metadata';
    status: 'deleted';
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One public SDK getById per probe; no create/destroy/native access.
 * Reviewed getInfo paths refresh metadata through one further public SDK read.
 * Only exact reviewed profile/oracle pairs may use their terminal metadata.
 * Modal's safe integer exit code means the original sandbox main process
 * finished (including nonzero exits); snapshot restores create a new ID.
 * Upstash's exact deleted status is irreversible for the original live box,
 * unlike resumable paused boxes; existing snapshots can remain.
 * Both new oracles require SDK-reserved native identity metadata as well.
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
  const modal = options.profileId === '@computesdk/modal' &&
    options.oracle === 'modal-finished-exitcode';
  const upstash = options.profileId === '@computesdk/upstash' &&
    options.oracle === 'upstash-deleted-metadata';
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
      : upstash
        ? {
          field: 'upstashStatus', status: 'deleted',
          observation: { kind: 'native-terminal', oracle: 'upstash-deleted-metadata', status: 'deleted' },
        } as const
        : undefined;
  if (!terminal && !modal) return { kind: 'present' };
  if (typeof found.getInfo !== 'function') {
    throw new Error('Cleanup lookup did not return a public SDK info method');
  }
  const info: unknown = await found.getInfo();
  if (!isRecord(info) || info.id !== ownedId ||
      (info.metadata !== undefined && !isRecord(info.metadata))) {
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  if ((modal || upstash) &&
      info.metadata?.[modal ? 'modalSandboxId' : 'upstashBoxId'] !== ownedId) {
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  if (modal) {
    const exitCode: unknown = info.metadata?.modalExitCode;
    // The adapter omits a null poll result while the original process runs.
    if (exitCode === undefined) return { kind: 'present' };
    if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) {
      throw new Error('Cleanup info did not return valid owned SDK metadata');
    }
    return { kind: 'native-terminal', oracle: 'modal-finished-exitcode', status: exitCode };
  }
  if (!terminal) return { kind: 'present' };
  const status: unknown = info.metadata?.[terminal.field];
  if (status !== undefined && typeof status !== 'string') {
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  return status === terminal.status
    ? terminal.observation
    : { kind: 'present' };
}

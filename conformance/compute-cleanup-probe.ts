import { withDeadline } from '../packages/test-utils/src/provider-lifecycle';

/** Fixed PUBLIC SDK stages, not native endpoint/request diagnostics. */
export type SdkProgress =
  | 'lookup-started' | 'lookup-returned' | 'lookup-rejected'
  | 'lookup-null' | 'lookup-wrong-identity' | 'lookup-valid'
  | 'info-unavailable' | 'info-started' | 'info-returned' | 'info-rejected'
  | 'info-invalid' | 'info-valid'
  | 'lookup-deadline' | 'info-deadline' | 'callback-deadline';
export type SdkObserver = (progress: SdkProgress) => unknown;

function notify(observer: SdkObserver | undefined, progress: SdkProgress): void {
  try {
    // Observability must never replace an SDK outcome or wait for a callback.
    void Promise.resolve(observer?.(progress)).catch(() => {});
  } catch { /* A synchronous observer failure is equally non-interfering. */ }
}

/**
 * Same sanitizing deadline as the caller previously used. Fence observations
 * when it expires or returns: unresolved SDK calls cannot update later probes.
 * A deadline describes the pending PUBLIC SDK stage only, never a native URL.
 */
export async function withSdkProgress<T>(
  operation: (observe: SdkObserver) => Promise<T>,
  timeoutMs: number,
  failureMessage: string,
  observer?: SdkObserver,
): Promise<T> {
  let open = true;
  let started = false;
  let settled = false;
  let pending: 'lookup' | 'info' | undefined;
  const expires = Date.now() + timeoutMs;
  const deadline = () => {
    if (!open) return;
    open = false;
    notify(observer, pending === 'lookup' ? 'lookup-deadline'
      : pending === 'info' ? 'info-deadline' : 'callback-deadline');
  };
  const observe: SdkObserver = progress => {
    if (!open) return;
    if (Date.now() >= expires) { deadline(); return; }
    pending = progress === 'lookup-started' ? 'lookup'
      : progress === 'info-started' ? 'info' : undefined;
    notify(observer, progress);
  };
  try {
    return await withDeadline(async () => {
      started = true;
      try { return await operation(observe); }
      finally { settled = true; }
    }, timeoutMs, failureMessage);
  } catch (error) {
    // Duration validation can reject before the operation starts; that is
    // not evidence that any public SDK stage reached a timer deadline.
    if (started && !settled) deadline();
    throw error;
  } finally { open = false; }
}

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
  observe?: SdkObserver;
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

/** The caller retains its existing exact owned-ID check after the deadline. */
export async function probePresence(
  manager: CleanupManager, ownedId: string, observe?: SdkObserver,
): Promise<CleanupSandbox | null> {
  notify(observe, 'lookup-started');
  let found;
  try { found = await manager.getById(ownedId); }
  catch (error) { notify(observe, 'lookup-rejected'); throw error; }
  notify(observe, 'lookup-returned');
  return found;
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
  const observe: SdkObserver = progress => notify(options.observe, progress);
  observe('lookup-started');
  let found;
  try { found = await manager.getById(ownedId); }
  catch (error) { observe('lookup-rejected'); throw error; }
  observe('lookup-returned');
  if (found === null) { observe('lookup-null'); return { kind: 'sdk-absent' }; }
  if (!isRecord(found) || found.sandboxId !== ownedId) {
    observe('lookup-wrong-identity');
    throw new Error('Cleanup lookup did not return the owned SDK ID');
  }
  observe('lookup-valid');
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
    observe('info-unavailable');
    throw new Error('Cleanup lookup did not return a public SDK info method');
  }
  observe('info-started');
  let info: unknown;
  try { info = await found.getInfo(); }
  catch (error) { observe('info-rejected'); throw error; }
  observe('info-returned');
  if (!isRecord(info) || info.id !== ownedId ||
      (info.metadata !== undefined && !isRecord(info.metadata))) {
    observe('info-invalid');
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  if ((modal || upstash) &&
      info.metadata?.[modal ? 'modalSandboxId' : 'upstashBoxId'] !== ownedId) {
    observe('info-invalid');
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  if (modal) {
    const exitCode: unknown = info.metadata?.modalExitCode;
    // The adapter omits a null poll result while the original process runs.
    if (exitCode === undefined) { observe('info-valid'); return { kind: 'present' }; }
    if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) {
      observe('info-invalid');
      throw new Error('Cleanup info did not return valid owned SDK metadata');
    }
    observe('info-valid');
    return { kind: 'native-terminal', oracle: 'modal-finished-exitcode', status: exitCode };
  }
  if (!terminal) return { kind: 'present' };
  const status: unknown = info.metadata?.[terminal.field];
  if (status !== undefined && typeof status !== 'string') {
    observe('info-invalid');
    throw new Error('Cleanup info did not return valid owned SDK metadata');
  }
  observe('info-valid');
  return status === terminal.status
    ? terminal.observation
    : { kind: 'present' };
}

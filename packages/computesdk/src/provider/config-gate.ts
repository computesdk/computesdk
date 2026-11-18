/**
 * Serializes access to vendor SDKs that keep credentials or backend selection
 * in process-global state — Beam's shared `beamOpts`, Blaxel's `initialize()`,
 * Microsandbox's default backend. A single Node process can serve calls built
 * with different credentials (e.g. multi-tenant hosts): without serialization
 * one call's configuration can be observed by another's in-flight request.
 *
 * The gate admits calls in *epochs* keyed by config identity. Calls with the
 * active key run concurrently; a call with a different key waits until the
 * active calls drain, then its `install` runs once and a new epoch begins.
 * Calls that arrive while a switch is pending queue in FIFO order, so a
 * waiting config can never be starved by same-key arrivals.
 *
 * `install` must be synchronous and idempotent: it runs while no other call
 * holds the gate, so it is the one safe point to mutate the shared vendor
 * state. Everything after it observes that epoch's configuration.
 */
export type InstallConfig = () => void;

export interface ConfigGate {
  /**
   * Run `fn` under `key`'s config epoch. `install` runs exactly once when a
   * new epoch for a different key begins — not on same-key joins. If `install`
   * throws, this call rejects and the next queued config gets its turn.
   */
  withConfig<T>(
    key: string,
    install: InstallConfig | undefined,
    fn: () => Promise<T>,
  ): Promise<T>;
}

interface ConfigWaiter {
  key: string;
  install?: InstallConfig;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
}

export function createConfigGate(): ConfigGate {
  let activeKey: string | null = null;
  let activeOps = 0;
  const waiters: ConfigWaiter[] = [];

  /** Admit the next queued config after an epoch drains. */
  const admitNext = (): void => {
    const next = waiters.shift();
    if (!next) return;
    try {
      next.install?.();
    } catch (error) {
      // A config that cannot be installed frees the gate for the configs
      // queued behind it instead of wedging the process.
      next.reject(error);
      admitNext();
      return;
    }
    activeKey = next.key;
    activeOps = 1;
    next.resolve(release);
  };

  const release = (): void => {
    activeOps--;
    if (activeOps > 0) return;
    activeKey = null;
    admitNext();
  };

  const acquire = (
    key: string,
    install: InstallConfig | undefined,
  ): (() => void) | Promise<() => void> => {
    // Fast path: join the active epoch when no switch is pending (preserves
    // same-key concurrency without starving waiters).
    if (activeKey === key && waiters.length === 0) {
      activeOps++;
      return release;
    }
    // Claim an idle gate. install is synchronous; if it throws, nothing was
    // claimed and the error reaches the caller unchanged.
    if (activeKey === null && waiters.length === 0) {
      install?.();
      activeKey = key;
      activeOps = 1;
      return release;
    }
    // Otherwise wait for a turn.
    return new Promise<() => void>((resolve, reject) => {
      waiters.push({ key, install, resolve, reject });
    });
  };

  return {
    async withConfig<T>(
      key: string,
      install: InstallConfig | undefined,
      fn: () => Promise<T>,
    ): Promise<T> {
      const releaseFn = await acquire(key, install);
      try {
        return await fn();
      } finally {
        releaseFn();
      }
    },
  };
}

/**
 * Associates the config a sandbox was created under with the returned native
 * object, so instance operations (runCommand, filesystem) can re-enter the
 * gate under their originating credentials. The stamp is a non-enumerable
 * symbol property — it never appears in serialized or logged output.
 */
export interface ConfigStamp<C> {
  stamp<T extends object>(target: T, config: C): T;
  config(target: unknown): C | undefined;
}

export function createConfigStamp<C>(): ConfigStamp<C> {
  const key = Symbol('computesdk.config-stamp');
  return {
    stamp<T extends object>(target: T, config: C): T {
      Object.defineProperty(target, key, {
        value: config,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      return target;
    },
    config(target: unknown): C | undefined {
      if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
        return undefined;
      }
      return (target as Record<symbol, C | undefined>)[key];
    },
  };
}

/** A FIFO queue whose adjacent operations can share one process-wide scope. */
export class BackendQueue<Selection, Context> {
  private batches: Batch<Selection, Context>[] = [];

  constructor(
    private readonly equal: (left: Selection, right: Selection) => boolean,
    private readonly scope: (selection: Selection, run: (context: Context) => Promise<void>) => Promise<void>,
  ) {}

  run<T>(selection: Selection, operation: (context: Context) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let batch = this.batches[this.batches.length - 1];
      // Once a different selection queues, later calls cannot jump ahead of it.
      if (!batch || batch.closed || !this.equal(batch.selection, selection)) {
        batch = { selection, jobs: [], running: 0, closed: false };
        this.batches.push(batch);
      }
      batch.jobs.push({
        run: async (context) => {
          try {
            const value = await operation(context);
            return () => resolve(value);
          } catch (error) {
            return () => reject(error);
          }
        },
        reject,
      });
      if (batch.context !== undefined) this.drain(batch);
      else if (this.batches.length === 1 && !batch.started) void this.start(batch);
    });
  }

  private async start(batch: Batch<Selection, Context>): Promise<void> {
    batch.started = true;
    let restored!: () => void;
    batch.restored = new Promise<void>((resolve) => { restored = resolve; });
    try {
      await this.scope(batch.selection, async (context) => {
        await new Promise<void>((resolve) => {
          batch.finish = resolve;
          batch.context = context;
          this.drain(batch);
        });
      });
    } catch (error) {
      batch.scopeFailure = { error };
      batch.closed = true;
      for (const job of batch.jobs.splice(0)) job.reject(error);
    } finally {
      // scope() has restored the previous backend before the next scope begins.
      this.batches.shift();
      restored();
      const next = this.batches[0];
      if (next) void this.start(next);
    }
  }

  private drain(batch: Batch<Selection, Context>): void {
    for (const job of batch.jobs.splice(0)) {
      batch.running++;
      void (async () => {
        const settle = await job.run(batch.context!);
        batch.running--;
        if (batch.running === 0 && batch.jobs.length === 0) {
          batch.closed = true;
          batch.finish!();
          // Wait for scope restoration before completing the final operation.
          await batch.restored;
          if (batch.scopeFailure) {
            job.reject(batch.scopeFailure.error);
            return;
          }
        }
        settle();
      })();
    }
  }
}

interface Batch<Selection, Context> {
  selection: Selection;
  jobs: Array<{ run(context: Context): Promise<() => void>; reject(error: unknown): void }>;
  running: number;
  started?: boolean;
  closed: boolean;
  context?: Context;
  finish?: () => void;
  restored?: Promise<void>;
  scopeFailure?: { error: unknown };
}

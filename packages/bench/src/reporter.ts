import { createBenchmarkClient } from './client';
import type {
  BenchmarkAssignment,
  BenchmarkClient,
  BenchmarkClientConfig,
  CreateWorkerArtifactResponse,
  JsonObject,
  TaskResultRecord,
  WorkerConcurrencySample,
} from './types';

const DEFAULT_REPORTER_BATCH_SIZE = 500;
const DEFAULT_READY_POLL_INTERVAL_MS = 1000;

export interface BenchmarkReporterConfig extends BenchmarkClientConfig {
  benchmarkSlug: string;
  runId: string;
  participantSlug: string;
  processKind?: string;
  processKey?: string;
  batchSize?: number;
}

export interface BenchmarkReporterProgress {
  done: number;
  inFlight: number;
  errors: number;
  total?: number;
}

export interface BenchmarkReporterArtifactInput {
  kind: string;
  name?: string;
  contentType?: string;
  body: BodyInit;
  metadata?: JsonObject;
}

export interface BenchmarkReporterHeartbeatInput {
  currentStep?: string | null;
  concurrency?: WorkerConcurrencySample[];
}

export interface BenchmarkReporterBarrierInput {
  step: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  active?: number;
  target?: number;
  concurrency?: WorkerConcurrencySample[];
}

export interface BenchmarkReporterBarrierResult {
  active: number | null;
  target: number | null;
  ready: boolean;
  measuredAt: string;
}

export class BenchmarkReporter {
  private readonly client: BenchmarkClient;
  private readonly assignment: BenchmarkAssignment;
  private readonly cfg: Required<Pick<BenchmarkReporterConfig, 'benchmarkSlug' | 'runId' | 'participantSlug' | 'batchSize'>>;
  private pending: TaskResultRecord[] = [];
  private sequenceNumber = 0;
  private flushChain: Promise<void> = Promise.resolve();
  private progress: BenchmarkReporterProgress;
  private barrier: { step: string; concurrency: WorkerConcurrencySample[] } | null = null;

  private constructor(client: BenchmarkClient, cfg: BenchmarkReporterConfig, assignment: BenchmarkAssignment) {
    this.client = client;
    this.assignment = assignment;
    this.cfg = {
      benchmarkSlug: cfg.benchmarkSlug,
      runId: cfg.runId,
      participantSlug: cfg.participantSlug,
      batchSize: cfg.batchSize ?? DEFAULT_REPORTER_BATCH_SIZE,
    };
    this.progress = { done: 0, inFlight: 0, errors: 0, total: assignment.taskRange.count };
  }

  static async claim(cfg: BenchmarkReporterConfig): Promise<BenchmarkReporter | null> {
    const client = createBenchmarkClient(cfg);
    try {
      const assignment = await client.claimWorker(cfg.benchmarkSlug, cfg.runId, cfg.participantSlug, {
        processKind: cfg.processKind,
        processKey: cfg.processKey,
      });
      return assignment ? new BenchmarkReporter(client, cfg, assignment) : null;
    } catch {
      return null;
    }
  }

  get workerAssignment(): BenchmarkAssignment {
    return this.assignment;
  }

  get taskCount(): number {
    return this.assignment.taskRange.count;
  }

  get taskIndexStart(): number {
    return this.assignment.taskRange.start;
  }

  setProgress(progress: BenchmarkReporterProgress): void {
    this.progress = { ...progress, total: progress.total ?? this.assignment.taskRange.count };
  }

  recordResult(record: TaskResultRecord): void {
    this.pending.push(record);
    if (this.pending.length >= this.cfg.batchSize) void this.flush(false);
  }

  async heartbeat(input: BenchmarkReporterHeartbeatInput = {}): Promise<void> {
    const barrier = this.barrier;
    const currentStep = barrier?.step ?? input.currentStep;
    const concurrency = barrier?.concurrency ?? input.concurrency;
    await this.client.heartbeatWorker(this.cfg.benchmarkSlug, this.cfg.runId, this.assignment.workerId, {
      attemptId: this.assignment.attemptId,
      progressDone: this.progress.done,
      progressInFlight: this.progress.inFlight,
      progressErrors: this.progress.errors,
      progressTotal: this.progress.total,
      ...(currentStep ? { currentStep } : {}),
      ...(concurrency ? { concurrency } : {}),
    }).catch(() => {});
  }

  async waitForStepReady(input: BenchmarkReporterBarrierInput): Promise<BenchmarkReporterBarrierResult> {
    const startedAt = Date.now();
    const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_READY_POLL_INTERVAL_MS;
    const concurrency = input.concurrency ?? [{
      step: input.step,
      active: input.active ?? this.assignment.taskRange.count,
      target: input.target ?? this.assignment.taskRange.count,
    }];
    this.barrier = { step: input.step, concurrency };
    try {
      while (true) {
        await this.heartbeat({ currentStep: input.step, concurrency });
        const progress = await this.client.getRunProgress(this.cfg.benchmarkSlug, this.cfg.runId).catch(() => null);
        const participant = progress?.participants.find((item) => item.slug === this.cfg.participantSlug);
        const step = participant?.concurrency.find((item) => item.step === input.step);
        if (step?.ready) {
          return {
            active: step.active,
            target: step.target,
            ready: true,
            measuredAt: progress?.generatedAt ?? new Date().toISOString(),
          };
        }
        if (input.timeoutMs !== undefined && Date.now() - startedAt >= input.timeoutMs) {
          throw new Error(`Timed out waiting for benchmark step "${input.step}" to become ready.`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } finally {
      this.barrier = null;
    }
  }

  uploadArtifact(input: BenchmarkReporterArtifactInput): Promise<CreateWorkerArtifactResponse | null> {
    return this.client.uploadWorkerArtifact(this.cfg.benchmarkSlug, this.cfg.runId, this.assignment.workerId, {
      attemptId: this.assignment.attemptId,
      kind: input.kind,
      name: input.name,
      contentType: input.contentType,
      metadata: input.metadata,
      body: input.body,
    }).catch(() => null);
  }

  flush(isFinal = false): Promise<void> {
    this.flushChain = this.flushChain.then(async () => {
      while (this.pending.length >= this.cfg.batchSize || (isFinal && this.pending.length > 0)) {
        const batch = this.pending.slice(0, this.cfg.batchSize);
        try {
          await this.client.sendTaskResults({
            benchmarkSlug: this.cfg.benchmarkSlug,
            runId: this.cfg.runId,
            workerId: this.assignment.workerId,
            attemptId: this.assignment.attemptId,
            sequenceNumber: this.sequenceNumber,
            isFinal: isFinal && batch.length === this.pending.length,
            records: batch,
          });
        } catch {
          break;
        }
        this.pending.splice(0, batch.length);
        this.sequenceNumber += 1;
      }
    });
    return this.flushChain;
  }

  async finish(failed = false, error?: unknown): Promise<void> {
    await this.flush(true).catch(() => {});
    if (failed) {
      await this.client.failWorker(
        this.cfg.benchmarkSlug,
        this.cfg.runId,
        this.assignment.workerId,
        this.assignment.attemptId,
        error,
      ).catch(() => {});
      return;
    }
    await this.client.completeWorker(
      this.cfg.benchmarkSlug,
      this.cfg.runId,
      this.assignment.workerId,
      this.assignment.attemptId,
    ).catch(() => {});
  }
}

export function claimBenchmarkReporter(config: BenchmarkReporterConfig): Promise<BenchmarkReporter | null> {
  return BenchmarkReporter.claim(config);
}

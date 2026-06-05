import { describe, expect, it } from 'vitest';
import { createBenchmarkClient } from '../client';

const shouldRun = process.env.COMPUTESDK_BENCH_INTEGRATION === '1' && !!process.env.COMPUTESDK_API_KEY;
const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration('benchmark orchestrator integration', () => {
  it('runs a worker through the platform orchestrator flow', async () => {
    const baseUrl = process.env.COMPUTESDK_BENCH_BASE_URL;
    const slug = `sdk-integration-${Date.now()}`;
    const participantSlug = 'just-bash';
    const client = createBenchmarkClient({ baseUrl });

    try {
      await client.upsertBenchmark(slug, {
        name: 'SDK Integration Smoke',
        kind: 'integration',
        config: { source: '@computesdk/bench' },
      });

      const { run, participants } = await client.createRun(slug, {
        name: 'SDK integration smoke',
        totalTasks: 2,
        workerCount: 1,
        participants: [participantSlug],
        config: { source: '@computesdk/bench' },
      });

      expect(run.id).toEqual(expect.any(String));
      expect(participants.some((participant) => participant.slug === participantSlug)).toBe(true);

      const workers = await client.planWorkers(slug, run.id, participantSlug, {
        workerCount: 1,
        targetConcurrency: 2,
      });
      expect(workers).toHaveLength(1);

      const assignment = await client.claimWorker(slug, run.id, participantSlug, {
        processKind: 'vitest',
        processKey: `local-${process.pid}-${Date.now()}`,
      });
      expect(assignment).not.toBeNull();
      if (!assignment) return;

      await client.heartbeatWorker(slug, run.id, assignment.workerId, {
        attemptId: assignment.attemptId,
        progressDone: 0,
        progressInFlight: 2,
        progressErrors: 0,
        progressTotal: 2,
        currentStep: 'integration.step',
        concurrency: [{ step: 'integration.step', active: 2, target: 2 }],
      });

      const progress = await client.getRunProgress(slug, run.id);
      const participant = progress.participants.find((item) => item.slug === participantSlug);
      expect(participant?.concurrency.some((item) => item.step === 'integration.step')).toBe(true);

      await client.sendTaskResults({
        benchmarkSlug: slug,
        runId: run.id,
        workerId: assignment.workerId,
        attemptId: assignment.attemptId,
        sequenceNumber: 0,
        isFinal: true,
        records: [
          {
            taskIndex: assignment.taskRange.start,
            status: 'success',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            latencyMs: 1,
            steps: [{ name: 'integration.step', status: 'success', latencyMs: 1 }],
            data: { ok: true },
          },
        ],
      });

      await client.completeWorker(slug, run.id, assignment.workerId, assignment.attemptId);

      const finalProgress = await client.getRunProgress(slug, run.id);
      const finalParticipant = finalProgress.participants.find((item) => item.slug === participantSlug);
      expect(finalParticipant?.workers.completed).toBeGreaterThanOrEqual(1);
    } finally {
      await client.deleteBenchmark(slug).catch(() => {});
    }
  }, 60_000);
});

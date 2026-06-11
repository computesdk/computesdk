import { describe, expect, it } from 'vitest';
import { BenchmarkApiError, createBenchmarkClient } from '../client';

const shouldRun = !!process.env.COMPUTESDK_ADMIN_API_KEY || !!process.env.COMPUTESDK_API_KEY;
const describeIntegration = shouldRun ? describe : describe.skip;

function isInvalidApiKeyError(error: unknown): boolean {
  return error instanceof BenchmarkApiError && error.status === 401 && error.body.includes('Invalid API key');
}

describeIntegration('benchmark orchestrator integration', () => {
  it('smokes the live platform orchestrator API contract', async () => {
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
      await expect(client.getBenchmark(slug)).resolves.toMatchObject({ slug });
      await expect(client.updateBenchmark(slug, {
        name: 'SDK Integration Smoke Updated',
        config: { source: '@computesdk/bench', updated: true },
      })).resolves.toMatchObject({ slug, name: 'SDK Integration Smoke Updated' });
      await expect(client.listBenchmarks()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ slug }),
      ]));

      const { run, participants } = await client.createRun(slug, {
        name: 'SDK integration smoke',
        totalTasks: 4,
        workerCount: 2,
        participants: [participantSlug],
        config: { source: '@computesdk/bench' },
      });

      expect(run.id).toEqual(expect.any(String));
      expect(participants.some((participant) => participant.slug === participantSlug)).toBe(true);
      await expect(client.getRun(slug, run.id)).resolves.toMatchObject({ id: run.id });
      await expect(client.updateRun(slug, run.id, {
        name: 'SDK integration smoke updated',
        config: { source: '@computesdk/bench', updated: true },
      })).resolves.toMatchObject({ id: run.id, name: 'SDK integration smoke updated' });
      await expect(client.listRuns(slug)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: run.id }),
      ]));

      await expect(client.listParticipants(slug, run.id)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ slug: participantSlug }),
      ]));
      await expect(client.getParticipant(slug, run.id, participantSlug)).resolves.toMatchObject({ slug: participantSlug });
      await expect(client.updateParticipant(slug, run.id, participantSlug, {
        label: 'Just Bash Smoke',
        config: { source: '@computesdk/bench', updated: true },
      })).resolves.toMatchObject({ slug: participantSlug, label: 'Just Bash Smoke' });

      const workers = await client.planWorkers(slug, run.id, participantSlug, {
        workerCount: 2,
        targetConcurrency: 2,
      });
      expect(workers).toHaveLength(2);
      await expect(client.listWorkers(slug, run.id, participantSlug)).resolves.toHaveLength(2);

      const firstWorker = await client.getWorker(slug, run.id, workers[0].id);
      expect(firstWorker).toMatchObject({ id: workers[0].id });
      await expect(client.updateWorker(slug, run.id, workers[0].id, {
        progressDone: 0,
        progressInFlight: 0,
        progressErrors: 0,
        progressTotal: firstWorker.taskIndexEnd - firstWorker.taskIndexStart + 1,
      })).resolves.toMatchObject({ id: workers[0].id });

      const firstAssignment = await client.claimWorker(slug, run.id, participantSlug, {
        processKind: 'vitest',
        processKey: `local-${process.pid}-${Date.now()}-complete`,
      });
      expect(firstAssignment).not.toBeNull();
      if (!firstAssignment) return;

      const secondAssignment = await client.claimWorker(slug, run.id, participantSlug, {
        processKind: 'vitest',
        processKey: `local-${process.pid}-${Date.now()}-fail`,
      });
      expect(secondAssignment).not.toBeNull();
      if (!secondAssignment) return;

      await client.heartbeatWorker(slug, run.id, firstAssignment.workerId, {
        attemptId: firstAssignment.attemptId,
        progressDone: 0,
        progressInFlight: 2,
        progressErrors: 0,
        progressTotal: firstAssignment.taskRange.count,
        currentStep: 'integration.step',
        concurrency: [{ step: 'integration.step', active: 2, target: 2 }],
      });

      const progress = await client.getRunProgress(slug, run.id);
      const participant = progress.participants.find((item) => item.slug === participantSlug);
      expect(participant?.concurrency.some((item) => item.step === 'integration.step')).toBe(true);

      await client.sendTaskResults({
        benchmarkSlug: slug,
        runId: run.id,
        workerId: firstAssignment.workerId,
        attemptId: firstAssignment.attemptId,
        sequenceNumber: 0,
        isFinal: true,
        records: [
          {
            taskIndex: firstAssignment.taskRange.start,
            status: 'success',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            latencyMs: 1,
            steps: [{ name: 'integration.step', status: 'success', latencyMs: 1 }],
            data: { ok: true },
          },
        ],
      });

      await client.completeWorker(slug, run.id, firstAssignment.workerId, firstAssignment.attemptId);
      await client.heartbeatWorker(slug, run.id, secondAssignment.workerId, {
        attemptId: secondAssignment.attemptId,
        progressDone: 0,
        progressInFlight: 0,
        progressErrors: 1,
        progressTotal: secondAssignment.taskRange.count,
      });
      await client.failWorker(slug, run.id, secondAssignment.workerId, secondAssignment.attemptId, new Error('integration smoke failure path'));

      const finalProgress = await client.getRunProgress(slug, run.id);
      const finalParticipant = finalProgress.participants.find((item) => item.slug === participantSlug);
      expect(finalParticipant?.workers.completed).toBeGreaterThanOrEqual(1);
      expect(finalParticipant?.workers.failed).toBeGreaterThanOrEqual(1);

      const overviewResults = await client.getBenchmarkResults(slug, { limit: 5 });
      expect(overviewResults.benchmark.slug).toBe(slug);
      expect(Array.isArray(overviewResults.items)).toBe(true);

      const runResults = await client.getRunResults(slug, run.id);
      expect(runResults.run.id).toBe(run.id);
      expect(Array.isArray(runResults.participants)).toBe(true);
      expect(Array.isArray(runResults.steps)).toBe(true);

      const taskResults = await client.getRunTaskResults(slug, run.id, { bucketSize: 10, failureLimit: 10 });
      expect(taskResults.run.id).toBe(run.id);
      expect(Array.isArray(taskResults.buckets)).toBe(true);
      expect(Array.isArray(taskResults.failures)).toBe(true);

      const timeline = await client.getRunTimeline(slug, run.id, { bucketMs: 1000 });
      expect(timeline.run.id).toBe(run.id);
      expect(Array.isArray(timeline.eventRate.buckets)).toBe(true);
      expect(Array.isArray(timeline.concurrency.points)).toBe(true);

      const imports = await client.getRunImports(slug, run.id);
      expect(imports.run.id).toBe(run.id);
      expect(imports.summary.eventBatches).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(imports.items)).toBe(true);
    } catch (error) {
      if (isInvalidApiKeyError(error)) {
        console.warn('Skipping bench orchestrator smoke - COMPUTESDK_ADMIN_API_KEY is invalid for the platform API.');
        return;
      }
      throw error;
    } finally {
      await client.updateBenchmark(slug, { status: 'archived' }).catch(() => {});
    }
  }, 90_000);
});

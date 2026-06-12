import { describe, expect, it } from 'vitest';
import { BenchmarkApiError, createBenchmarkClient } from '../client';

const shouldRun = !!process.env.COMPUTESDK_ADMIN_API_KEY || !!process.env.COMPUTESDK_API_KEY;
const describeCapabilities = shouldRun ? describe : describe.skip;

function isInvalidApiKeyError(error: unknown): boolean {
  return error instanceof BenchmarkApiError && error.status === 401 && error.body.includes('Invalid API key');
}

function isOptionalCapabilityMissing(error: unknown): boolean {
  return error instanceof BenchmarkApiError && [404, 405, 501].includes(error.status);
}

async function probeOptionalCapability<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn();
    console.info(`Bench orchestrator capability "${name}" is available.`);
    return result;
  } catch (error) {
    if (isOptionalCapabilityMissing(error)) {
      console.warn(`Bench orchestrator capability "${name}" is unavailable in this environment.`);
      return undefined;
    }
    throw error;
  }
}

function artifactIdOf(artifact: { id?: string; artifactId?: string }): string | undefined {
  return artifact.artifactId ?? artifact.id;
}

describeCapabilities('benchmark orchestrator capabilities', () => {
  it('requires artifact endpoints and reports release availability', async () => {
    const baseUrl = process.env.COMPUTESDK_BENCH_BASE_URL;
    const slug = `sdk-capabilities-${Date.now()}`;
    const participantSlug = 'just-bash';
    const artifactName = 'sdk-capability-smoke-meta.json';
    const client = createBenchmarkClient({ baseUrl });

    try {
      await client.upsertBenchmark(slug, {
        name: 'SDK Capabilities Smoke',
        kind: 'integration',
        config: { source: '@computesdk/bench', capabilitySmoke: true },
      });

      const { run } = await client.createRun(slug, {
        name: 'SDK capabilities smoke',
        totalTasks: 1,
        workerCount: 1,
        participants: [participantSlug],
        config: { source: '@computesdk/bench', capabilitySmoke: true },
      });

      const workers = await client.planWorkers(slug, run.id, participantSlug, {
        workerCount: 1,
        targetConcurrency: 1,
      });
      expect(workers).toHaveLength(1);

      const assignment = await client.claimWorker(slug, run.id, participantSlug, {
        processKind: 'vitest',
        processKey: `local-${process.pid}-${Date.now()}-capabilities`,
      });
      expect(assignment).not.toBeNull();
      if (!assignment) return;

      const artifact = await client.createWorkerArtifact(slug, run.id, assignment.workerId, {
        attemptId: assignment.attemptId,
        kind: 'meta.json',
        name: artifactName,
        contentType: 'application/json',
        metadata: { source: '@computesdk/bench', capabilitySmoke: true },
      });
      const artifactId = artifact.artifactId ?? (artifact.artifact ? artifactIdOf(artifact.artifact) : undefined);
      const uploadUrl = artifact.uploadUrl ?? artifact.artifact?.uploadUrl;
      expect(artifactId).toEqual(expect.any(String));
      expect(artifact.objectKey ?? artifact.artifact?.objectKey).toEqual(expect.any(String));
      expect(uploadUrl).toEqual(expect.any(String));

      const uploadResponse = await fetch(uploadUrl!, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: '@computesdk/bench', capabilitySmoke: true, runId: run.id }),
      });
      expect(uploadResponse.ok, await uploadResponse.text()).toBe(true);

      const runArtifacts = await client.listRunArtifacts(slug, run.id);
      expect(runArtifacts.some((item) => artifactIdOf(item) === artifactId)).toBe(true);
      expect(runArtifacts.some((item) => artifactIdOf(item) === artifactId && item.name === artifactName)).toBe(true);

      const workerArtifacts = await client.listWorkerArtifacts(slug, run.id, assignment.workerId);
      expect(workerArtifacts.some((item) => artifactIdOf(item) === artifactId)).toBe(true);
      expect(workerArtifacts.some((item) => artifactIdOf(item) === artifactId && item.name === artifactName)).toBe(true);

      const releaseResult = await probeOptionalCapability('worker release', () => client.releaseWorker(slug, run.id, assignment.workerId, assignment.attemptId));
      if (releaseResult) {
        expect(releaseResult.worker.id).toBe(assignment.workerId);
      } else {
        await client.failWorker(slug, run.id, assignment.workerId, assignment.attemptId, new Error('capability smoke release fallback'));
      }
    } catch (error) {
      if (isInvalidApiKeyError(error)) {
        console.warn('Skipping bench orchestrator capabilities smoke - COMPUTESDK_ADMIN_API_KEY is invalid for the platform API.');
        return;
      }
      throw error;
    } finally {
      await client.updateBenchmark(slug, { status: 'archived' }).catch(() => {});
    }
  }, 60_000);
});

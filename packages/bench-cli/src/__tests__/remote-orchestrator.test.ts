import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { runRemote } from '../remote';
import { loadBenchFile } from '../loader';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FIXTURE_FILE = `${FIXTURES_DIR}benchmarks/strings.bench.ts`;

function makeFakeClient() {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    upsertBenchmark: vi.fn(async (...args: unknown[]) => { calls.push({ method: 'upsertBenchmark', args }); return {}; }),
    createRun: vi.fn(async (...args: unknown[]) => { calls.push({ method: 'createRun', args }); return { run: { id: 'run-76' } }; }),
    planWorkers: vi.fn(async (...args: unknown[]) => { calls.push({ method: 'planWorkers', args }); return {}; }),
    getRunProgress: vi.fn(async () => ({ summary: { status: 'completed', participants: { total: 1 } }, participants: [] })),
    getRunTaskResults: vi.fn(async () => ({ buckets: [] })),
  };
  return { client, calls };
}

describe('remote orchestrator', () => {
  it('throws when the bench file registers no benchmarks', async () => {
    const tmp = `${FIXTURE_FILE}.empty.bench.ts`;
    const { writeFileSync, unlinkSync } = await import('node:fs');
    writeFileSync(tmp, 'export {};\n');
    try {
      const sink = new PassThrough();
      const stdout = sink as unknown as NodeJS.WriteStream;
      const { client } = makeFakeClient();
      try {
        await runRemote(tmp, { clientFactory: () => client as any, stdout, workers: 1, total: 1 });
        throw new Error('expected to throw');
      } catch (error) {
        expect((error as Error).message).toMatch(/No benchmarks registered/);
      }
    } finally {
      unlinkSync(tmp);
    }
  });

  it('throws on --workers < 1', async () => {
    const sink = new PassThrough();
    const stdout = sink as unknown as NodeJS.WriteStream;
    const { client } = makeFakeClient();
    await expect(runRemote(FIXTURE_FILE, { clientFactory: () => client as any, stdout, workers: 0 })).rejects.toThrow(/--workers must be >= 1/);
  });

  it('counts registered benches via loadBenchFile', async () => {
    const entries = await loadBenchFile(FIXTURE_FILE);
    expect(entries.length).toBeGreaterThan(0);
  });
});

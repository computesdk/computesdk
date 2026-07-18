import { fork } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { createBenchmarkClient, BenchmarkReporter, type BenchmarkClient } from '@computesdk/bench';
import type { BenchmarkEntry, RemoteOptions } from './types';
import { loadBenchFile } from './loader';

const PACKAGE_NAME = '@computesdk/bench-cli';
const DEFAULT_PARTICIPANT = 'bench-cli';
const DEFAULT_TOTAL = 100;
const DEFAULT_WORKERS = 1;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_KIND = 'bench-cli';

export interface RemoteRunOptions extends RemoteOptions {
  cwd?: string;
  /** Override the writer for status updates. */
  stdout?: NodeJS.WritableStream;
  /** Override the platform client for tests. */
  clientFactory?: (config: { apiKey?: string; baseUrl?: string }) => BenchmarkClient;
}

export interface RemoteRunResult {
  benchmarkSlug: string;
  runId: string;
  totalTasks: number;
  workerCount: number;
  pass: number;
  failed: number;
}

/**
 * Plan a benchmark run on the platform and fork local worker processes.
 */
export async function runRemote(
  file: string,
  options: RemoteRunOptions = {},
): Promise<RemoteRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const absoluteFile = path.resolve(cwd, file);
  const out = options.stdout ?? process.stdout;

  // Phase 1: capture entry list (no measurement yet)
  const entries = await loadBenchFile(absoluteFile);
  const benchCount = entries.length;
  if (benchCount === 0) {
    throw new Error(`No benchmarks registered in ${absoluteFile}; nothing to ship to the platform.`);
  }

  const slug = options.slug ?? defaultSlug(absoluteFile);
  const runName = options.runName ?? defaultRunName(absoluteFile);
  const total = options.total ?? DEFAULT_TOTAL;
  const workers = options.workers ?? DEFAULT_WORKERS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const participant = options.participant ?? DEFAULT_PARTICIPANT;
  const totalTasks = benchCount * total;

  if (workers < 1) throw new Error('--workers must be >= 1');
  if (concurrency < 1) throw new Error('--concurrency must be >= 1');
  if (total < 1) throw new Error('--total must be >= 1');

  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const client = clientFactory({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  out.write(`${pc.cyan(pc.bold(' bench '))}${pc.dim(' planning ')}${pc.cyan(`${slug} `)}${pc.dim('on')} ${pc.cyan(participant)}\n`);
  out.write(`  ${pc.dim('file:')}        ${absoluteFile}\n`);
  out.write(`  ${pc.dim('benchmarks:')}  ${benchCount}\n`);
  out.write(`  ${pc.dim('total/bench:')} ${total}\n`);
  out.write(`  ${pc.dim('totalTasks:')}  ${totalTasks}\n`);
  out.write(`  ${pc.dim('workers:')}     ${workers}\n`);
  out.write(`  ${pc.dim('concurrency:')} ${concurrency}\n\n`);

  await client.upsertBenchmark(slug, {
    name: slug,
    kind: DEFAULT_KIND,
    config: {
      source: PACKAGE_NAME,
      benchFile: absoluteFile,
      benchCount,
      totalPerBench: total,
      iterations: 1,
    },
  });

  const { run } = await client.createRun(slug, {
    name: runName,
    totalTasks,
    workerCount: workers,
    participants: [participant],
    config: { concurrency },
  });

  for (let i = 0; i < workers; i += 1) await client.planWorkers(slug, run.id, participant);

  out.write(`${pc.cyan(pc.bold(' bench '))}${pc.dim(' run ')}${pc.cyan(run.id)} ${pc.dim('started. forking')} ${pc.cyan(`${workers}`)} ${pc.dim('worker(s).')}\n\n`);

  // Phase 2: fork worker subprocesses that pull tasks from the platform.
  const workerArgs = [
    '--remote-worker',
    '--file',
    absoluteFile,
    '--cwd',
    cwd,
  ];
  const child = (env: Record<string, string>) =>
    forkWorker(workerArgs, {
      BENCH_CLI_REMOTE_SLUG: slug,
      BENCH_CLI_REMOTE_RUN_ID: run.id,
      BENCH_CLI_REMOTE_PARTICIPANT: participant,
      BENCH_CLI_REMOTE_TOTAL: String(total),
      BENCH_CLI_REMOTE_BENCH_COUNT: String(benchCount),
      BENCH_CLI_REMOTE_CONCURRENCY: String(concurrency),
      ...env,
    });

  // Use a single parent worker that loops, mirroring the per-task slot
  // assignment of the platform API. Locally we still get N parallel
  // processes; each one drains its claimed range before exiting.
  const workers_ = Array.from({ length: workers }, (_, index) =>
    child({
      BENCH_CLI_REMOTE_WORKER_KEY: `bench-cli-${process.pid}-${index}`,
    }),
  );

  // Phase 3: poll for progress and print a TUI until workers exit.
  const finished = await waitForWorkers(workers_, {
    onPoll: () => pollProgress(client, slug, run.id, out),
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: (options.timeoutSeconds ?? 0) * 1000,
  });

  // Phase 4: print final summary.
  const finalSummary = await fetchFinalSummary(client, slug, run.id);
  printFinalSummary(out, slug, run.id, finalSummary, finished);
  return {
    benchmarkSlug: slug,
    runId: run.id,
    totalTasks,
    workerCount: workers,
    pass: finished.pass,
    failed: finished.failed,
  };
}

function forkWorker(args: readonly string[], env: Record<string, string>): Promise<{ exitCode: number; pass: number; failed: number }> {
  return new Promise((resolve) => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const entry = path.join(here, '..', 'bin', 'bench-worker.js');
    const child = fork(entry, [...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let reportedPass = 0;
    let reportedFailed = 0;
    child.on('message', (msg: unknown) => {
      if (msg && typeof msg === 'object' && 'kind' in msg) {
        const m = msg as { kind: string; pass?: number; failed?: number };
        if (m.kind === 'progress' && typeof m.pass === 'number' && typeof m.failed === 'number') {
          reportedPass = m.pass;
          reportedFailed = m.failed;
        }
      }
    });
    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 0, pass: reportedPass, failed: reportedFailed });
    });
    child.on('error', () => {
      resolve({ exitCode: 1, pass: reportedPass, failed: reportedFailed });
    });
  });
}

async function waitForWorkers(
  workers: Array<Promise<{ exitCode: number; pass: number; failed: number }>>,
  options: { onPoll?: () => Promise<void>; pollIntervalMs: number; timeoutMs: number },
): Promise<{ pass: number; failed: number; exitCodes: number[] }> {
  const start = Date.now();
  let running = true;
  const exitCodes: number[] = [];
  let pass = 0;
  let failed = 0;
  const pollIntervalMs = options.pollIntervalMs;

  const timeoutPromise = options.timeoutMs > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, options.timeoutMs).unref())
    : new Promise<void>(() => {});

  const pollPromise = (async () => {
    while (running) {
      try {
        await options.onPoll?.();
      } catch {
        // Ignore poll errors; continue waiting.
      }
      await sleep(pollIntervalMs);
    }
  })();

  const settled = await Promise.race([
    Promise.all(workers.map(async (p) => {
      const result = await p;
      exitCodes.push(result.exitCode);
      pass += result.pass;
      failed += result.failed;
    })).then(() => 'workers' as const),
    timeoutPromise.then(() => 'timeout' as const),
  ]);
  running = false;
  await pollPromise.catch(() => {});
  void start;
  void settled;
  return { pass, failed, exitCodes };
}

async function pollProgress(client: BenchmarkClient, slug: string, runId: string, out: NodeJS.WritableStream): Promise<void> {
  try {
    const progress = await client.getRunProgress(slug, runId);
    const summary = progress.summary;
    const participants = progress.participants;
    // Aggregate across participants; runs with one participant pick the
    // only entry, runs with multiple sum the totals.
    let totalWorkers = 0;
    let readyWorkers = 0;
    let totalTasks = 0;
    let doneTasks = 0;
    let errorTasks = 0;
    for (const p of participants) {
      totalWorkers += p.workers?.total ?? 0;
      readyWorkers += (p.workers?.running ?? 0) + (p.workers?.completed ?? 0);
      totalTasks += p.tasks?.total ?? 0;
      doneTasks += p.tasks?.done ?? 0;
      errorTasks += p.tasks?.errors ?? 0;
    }
    if (totalWorkers === 0) {
      totalWorkers = summary.participants?.total ?? 0;
    }
    out.write(
      `\r${pc.cyan(' progress ')}` +
        pc.dim(' status=') + pc.cyan(summary.status ?? 'unknown') +
        pc.dim(' workers=') + pc.cyan(`${readyWorkers}/${totalWorkers}`) +
        pc.dim(' tasks=') + pc.cyan(`${doneTasks}/${totalTasks}`) +
        pc.dim(' errors=') + pc.cyan(String(errorTasks)) +
        '   ',
    );
  } catch {
    // Polling errors are non-fatal during long-running runs.
  }
}

async function fetchFinalSummary(client: BenchmarkClient, slug: string, runId: string): Promise<{ total: number; failed: number; pass: number }> {
  try {
    const tasks = await client.getRunTaskResults(slug, runId, { bucketSize: 50, failureLimit: 0 });
    let pass = 0;
    let failed = 0;
    let total = 0;
    for (const bucket of tasks.buckets ?? []) {
      total += bucket.taskCount;
      pass += bucket.successCount;
      failed += bucket.errorCount;
    }
    return { total, pass, failed };
  } catch {
    return { total: 0, pass: 0, failed: 0 };
  }
}

function printFinalSummary(
  out: NodeJS.WritableStream,
  slug: string,
  runId: string,
  summary: { total: number; failed: number; pass: number },
  workers: { exitCodes: number[]; pass: number; failed: number },
): void {
  out.write('\n\n');
  if (summary.failed === 0 && workers.exitCodes.every((c) => c === 0)) {
    out.write(
      pc.green(pc.bold(` ✓ remote run ${runId} (${slug}) completed: `)) +
        pc.gray(`${summary.pass}/${summary.total} tasks passed across ${workers.exitCodes.length} worker(s).`),
    );
  } else {
    out.write(
      pc.red(pc.bold(` ✗ remote run ${runId} (${slug}) finished with errors: `)) +
        pc.gray(`${summary.failed} failed, ${summary.pass} passed.`),
    );
    process.exitCode = 1;
  }
  out.write('\n');
}

function defaultSlug(absoluteFile: string): string {
  const base = path.basename(absoluteFile).replace(/\.(bench|ts|js|mjs|cts|mts)$/i, '');
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return safe || 'bench-cli';
}

function defaultRunName(absoluteFile: string): string {
  const base = path.basename(absoluteFile);
  return `${base} @ ${new Date().toISOString()}`;
}

function defaultClientFactory(config: { apiKey?: string; baseUrl?: string }): BenchmarkClient {
  return createBenchmarkClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export so the worker process can use the polling helpers if needed.
export { BenchmarkReporter };
export type { BenchmarkEntry };

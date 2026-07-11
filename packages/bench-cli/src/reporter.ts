import pc from 'picocolors';
import type { BenchmarkFileSummary, BenchmarkResult, RunOptions } from './types';
import type { ProgressListener } from './runner';

const RESET = '\u001b[2K';
const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';

export interface ReporterOptions {
  /** Reporter style; `default` prints a vitest-like TUI, `json` prints a single JSON blob. */
  format: 'default' | 'json';
  /** Stream-like sink. Defaults to {@link process.stdout} for `default` and `process.stdout` for `json`. */
  stdout?: NodeJS.WritableStream;
  /** Whether the reporter supports live updates. Defaults to true when the sink is a TTY. */
  live?: boolean;
}

export class DefaultReporter {
  private readonly out: NodeJS.WritableStream;
  private readonly live: boolean;
  private cursorHidden = false;
  private files: Map<string, { results: BenchmarkResult[]; pending: BenchmarkResult[] }> = new Map();
  private startedAt = 0;

  constructor(options: ReporterOptions) {
    this.out = options.stdout ?? process.stdout;
    const isTTY =
      typeof (this.out as NodeJS.WriteStream).isTTY === 'boolean' && (this.out as NodeJS.WriteStream).isTTY === true;
    this.live = options.live ?? isTTY;
  }

  onStart(_options: RunOptions, files: readonly string[]): void {
    this.startedAt = Date.now();
    for (const file of files) {
      this.files.set(file, { results: [], pending: [] });
    }
    if (files.length > 0) {
      this.writeLine(pc.cyan(pc.bold(' bench ')) + pc.dim(' running ') + pc.cyan(`${files.length} file(s)`));
      for (const file of files) {
        this.writeLine('  ' + pc.dim(file));
      }
      this.writeLine('');
      if (this.live) this.hideCursor();
    }
  }

  onProgress: ProgressListener = (entry, status, result) => {
    const bucket = this.files.get(entry.file);
    if (!bucket) return;
    if (status === 'start') {
      this.writeLine(
        pc.dim('  • ') +
          pc.bold(entry.name) +
          pc.dim('  …') +
          (entry.groups.length > 0 ? '  ' + pc.dim('(' + entry.groups.join(' › ') + ')') : ''),
      );
      if (this.live) this.hideCursor();
    } else if (result) {
      bucket.results.push(result);
      if (result.status === 'failed') {
        this.writeLine(
          pc.red('  ✗ ') + pc.bold(entry.name) + pc.red('  failed') + (result.error ? '\n' + indent(result.error, 4) : ''),
        );
      } else {
        this.writeLine(
          pc.green('  ✓ ') +
            pc.bold(entry.name) +
            pc.gray('  ' + formatHz(result.hz)) +
            pc.dim('  (' + formatMs(result.meanMs) + ' / iter)'),
        );
      }
    }
  };

  onFinish(summaries: readonly BenchmarkFileSummary[]): void {
    if (this.live) this.showCursor();
    const totals = summarize(summaries);
    this.writeLine('');
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(2);
    if (totals.failed === 0) {
      this.writeLine(
        pc.green(pc.bold(` ✓ ${totals.pass} benchmark(s) passed`)) +
          pc.gray(` in ${elapsed}s across ${summaries.length} file(s)`),
      );
    } else {
      this.writeLine(
        pc.red(pc.bold(` ✗ ${totals.failed} benchmark(s) failed`)) +
          pc.gray(` ${totals.pass} passed in ${elapsed}s`),
      );
      process.exitCode = 1;
    }
  }

  private writeLine(text: string): void {
    if (this.live) {
      (this.out as NodeJS.WriteStream).write?.(RESET + '\r');
    }
    (this.out as NodeJS.WriteStream).write?.(text + '\n');
  }

  private hideCursor(): void {
    if (this.cursorHidden) return;
    (this.out as NodeJS.WriteStream).write?.(HIDE_CURSOR);
    this.cursorHidden = true;
  }

  private showCursor(): void {
    if (!this.cursorHidden) return;
    (this.out as NodeJS.WriteStream).write?.(SHOW_CURSOR);
    this.cursorHidden = false;
  }
}

export class JsonReporter {
  private readonly out: NodeJS.WritableStream;
  private summaries: BenchmarkFileSummary[] = [];

  constructor(options: ReporterOptions) {
    this.out = options.stdout ?? process.stdout;
  }

  onStart(_options: RunOptions, _files: readonly string[]): void {
    this.summaries = [];
  }

  onProgress: ProgressListener = (_entry, _status, _result) => {
    /* collected at finish by capturing summaries */
  };

  onFinish(summaries: readonly BenchmarkFileSummary[]): void {
    (this.out as NodeJS.WriteStream).write?.(JSON.stringify({ summaries }, null, 2) + '\n');
    const totals = summarize(summaries);
    if (totals.failed > 0) process.exitCode = 1;
  }
}

function summarize(summaries: readonly BenchmarkFileSummary[]): { pass: number; failed: number } {
  let pass = 0;
  let failed = 0;
  for (const summary of summaries) {
    pass += summary.pass;
    failed += summary.failed;
  }
  return { pass, failed };
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

function formatHz(hz: number): string {
  if (!isFinite(hz) || hz <= 0) return '– ops/sec';
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} M ops/sec`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)} k ops/sec`;
  return `${hz.toFixed(2)} ops/sec`;
}

function formatMs(value: number): string {
  if (!isFinite(value) || value <= 0) return '–';
  if (value >= 1) return `${value.toFixed(2)} ms`;
  if (value >= 0.001) return `${(value * 1_000).toFixed(2)} µs`;
  return `${(value * 1_000_000).toFixed(2)} ns`;
}

export function createReporter(options: { format?: 'default' | 'json'; stdout?: NodeJS.WritableStream; live?: boolean } = {}): DefaultReporter | JsonReporter {
  const format = options.format ?? 'default';
  return format === 'json'
    ? new JsonReporter({ format, ...(options.stdout ? { stdout: options.stdout } : {}) })
    : new DefaultReporter({ format, ...(options.stdout ? { stdout: options.stdout } : {}), ...(options.live !== undefined ? { live: options.live } : {}) });
}

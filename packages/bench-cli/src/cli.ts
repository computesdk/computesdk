import process from 'node:process';
import { runCommand } from './run-command';
import { listCommand } from './list-command';
import { DEFAULT_ITERATIONS, DEFAULT_WARMUP } from './dsl';

const PACKAGE_NAME = '@computesdk/bench-cli';

type Subcommand = 'run' | 'list';

export interface ParsedArgs {
  subcommand: Subcommand;
  files: string[];
  iterations: number;
  warmup: number;
  reporter: 'default' | 'json';
  bail: boolean;
  cwd: string;
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    subcommand: 'run',
    files: [],
    iterations: DEFAULT_ITERATIONS,
    warmup: DEFAULT_WARMUP,
    reporter: 'default',
    bail: false,
    cwd: process.cwd(),
    showHelp: false,
    showVersion: false,
  };

  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help' || arg === 'help') {
      result.showHelp = true;
      i += 1;
      continue;
    }
    if (arg === '-V' || arg === '--version' || arg === 'version') {
      result.showVersion = true;
      i += 1;
      continue;
    }
    if (arg === 'run' || arg === 'list') {
      result.subcommand = arg;
      i += 1;
      continue;
    }
    if (arg === '--bail') {
      result.bail = true;
      i += 1;
      continue;
    }
    if (arg === '--cwd' || arg.startsWith('--cwd=')) {
      consumeValue(arg, '--cwd', argv, i, (value) => {
        result.cwd = value;
        return 1;
      });
      i += arg.startsWith('--cwd=') ? 1 : 2;
      continue;
    }
    if (arg === '-i' || arg === '--iterations' || arg.startsWith('--iterations=')) {
      consumeValue(arg, '--iterations', argv, i, (value) => {
        result.iterations = parseCount(value, 'iterations');
        return 1;
      });
      i += arg.startsWith('--iterations=') ? 1 : 2;
      continue;
    }
    if (arg === '-w' || arg === '--warmup' || arg.startsWith('--warmup=')) {
      consumeValue(arg, '--warmup', argv, i, (value) => {
        result.warmup = parseCount(value, 'warmup');
        return 1;
      });
      i += arg.startsWith('--warmup=') ? 1 : 2;
      continue;
    }
    if (arg === '-r' || arg === '--reporter' || arg.startsWith('--reporter=')) {
      consumeValue(arg, '--reporter', argv, i, (value) => {
        result.reporter = value === 'json' ? 'json' : 'default';
        return 1;
      });
      i += arg.startsWith('--reporter=') ? 1 : 2;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    }
    positional.push(arg);
    i += 1;
  }

  result.files = positional;
  return result;
}

function consumeValue(
  arg: string,
  longName: string,
  argv: readonly string[],
  index: number,
  consume: (value: string) => void,
): void {
  const eq = arg.indexOf('=');
  if (eq !== -1) {
    consume(arg.slice(eq + 1));
    return;
  }
  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`${longName} requires a value`);
  }
  consume(next);
}

function parseCount(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

export function renderHelp(): string {
  return [
    `Usage: bench [run|list] [files...] [options]`,
    ``,
    `${PACKAGE_NAME} - run TypeScript benchmark files from a benchmarks/ folder.`,
    `Similar to vitest: drop *.bench.ts files in ./benchmarks/ and run \`bench\` to execute them.`,
    ``,
    `Subcommands:`,
    `  run [files...]   (default) Run benchmark files.`,
    `  list [files...]  List discovered benchmark files.`,
    ``,
    `Options:`,
    `  -i, --iterations <n>    iterations per benchmark (default ${DEFAULT_ITERATIONS})`,
    `  -w, --warmup <n>        warmup iterations (default ${DEFAULT_WARMUP})`,
    `  -r, --reporter <fmt>    reporter format: default | json (default default)`,
    `  --bail                  stop on first failure`,
    `  --cwd <path>            working directory`,
    `  -h, --help              show this help`,
    `  -V, --version           print version`,
  ].join('\n');
}

/**
 * Backwards-compatible alias retained for tests and API consumers that
 * relied on the prior commander-based entry point.
 */
export function buildProgram(_version: string): { parse: (argv: string[]) => ParsedArgs } {
  return {
    parse(argv: string[]) {
      return parseArgs(argv);
    },
  };
}

/**
 * Parse argv and execute the program. Returns the exit code (0 on success).
 */
export async function runCli(argv: readonly string[], version: string): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.showHelp) {
      process.stdout.write(renderHelp() + '\n');
      return 0;
    }
    if (parsed.showVersion) {
      process.stdout.write(version + '\n');
      return 0;
    }

    if (parsed.subcommand === 'list') {
      await listCommand(parsed.files, { cwd: parsed.cwd });
      return typeof process.exitCode === 'number' ? process.exitCode : 0;
    }
    await runCommand(parsed.files, {
      cwd: parsed.cwd,
      iterations: parsed.iterations,
      warmup: parsed.warmup,
      reporter: parsed.reporter,
      bail: parsed.bail,
    });
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`bench: ${message}\n`);
    return 1;
  }
}

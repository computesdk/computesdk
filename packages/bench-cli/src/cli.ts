import process from 'node:process';
import { runCommand } from './run-command';
import { listCommand } from './list-command';
import { runRemote } from './remote';
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
  remote: boolean;
  remoteOptions: {
    slug?: string;
    runName?: string;
    total?: number;
    workers?: number;
    concurrency?: number;
    participant?: string;
    apiKey?: string;
    baseUrl?: string;
    pollIntervalMs?: number;
    timeoutSeconds?: number;
  };
  showHelp: boolean;
  showVersion: boolean;
}

interface RemoteSpec {
  name: string;
  dest: keyof ParsedArgs['remoteOptions'];
  kind: 'string' | 'positive';
}

const REMOTE_SPECS: readonly RemoteSpec[] = [
  { name: 'slug', dest: 'slug', kind: 'string' },
  { name: 'run-name', dest: 'runName', kind: 'string' },
  { name: 'total', dest: 'total', kind: 'positive' },
  { name: 'workers', dest: 'workers', kind: 'positive' },
  { name: 'concurrency', dest: 'concurrency', kind: 'positive' },
  { name: 'participant', dest: 'participant', kind: 'string' },
  { name: 'api-key', dest: 'apiKey', kind: 'string' },
  { name: 'base-url', dest: 'baseUrl', kind: 'string' },
  { name: 'poll-interval', dest: 'pollIntervalMs', kind: 'positive' },
  { name: 'timeout', dest: 'timeoutSeconds', kind: 'positive' },
];

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    subcommand: 'run',
    files: [],
    iterations: DEFAULT_ITERATIONS,
    warmup: DEFAULT_WARMUP,
    reporter: 'default',
    bail: false,
    cwd: process.cwd(),
    remote: false,
    remoteOptions: {},
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
    if (arg === '--remote') {
      result.remote = true;
      i += 1;
      continue;
    }
    if (arg === '--cwd' || arg.startsWith('--cwd=')) {
      i = consumeValueOption(arg, argv, i, '--cwd', (value) => {
        result.cwd = value;
      });
      continue;
    }
    if (arg === '-i' || arg === '--iterations' || arg.startsWith('--iterations=')) {
      i = consumeValueOption(arg, argv, i, '--iterations', (value) => {
        result.iterations = parseCount(value, 'iterations');
      });
      continue;
    }
    if (arg === '-w' || arg === '--warmup' || arg.startsWith('--warmup=')) {
      i = consumeValueOption(arg, argv, i, '--warmup', (value) => {
        result.warmup = parseCount(value, 'warmup');
      });
      continue;
    }
    if (arg === '-r' || arg === '--reporter' || arg.startsWith('--reporter=')) {
      i = consumeValueOption(arg, argv, i, '--reporter', (value) => {
        result.reporter = value === 'json' ? 'json' : 'default';
      });
      continue;
    }

    const remoteMatch = matchRemoteOption(arg);
    if (remoteMatch) {
      const { spec, inlineValue } = remoteMatch;
      i = consumeRemoteValue(arg, argv, i, spec, (value) => {
        applyRemoteValue(result.remoteOptions, spec, value);
      }, inlineValue);
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

function consumeValueOption(
  arg: string,
  argv: readonly string[],
  index: number,
  longName: string,
  consume: (value: string) => void,
): number {
  const eq = arg.indexOf('=');
  if (eq !== -1) {
    consume(arg.slice(eq + 1));
    return index + 1;
  }
  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`${longName} requires a value`);
  }
  consume(next);
  return index + 2;
}

function matchRemoteOption(arg: string): { spec: RemoteSpec; inlineValue: string | null } | null {
  if (!arg.startsWith('--')) return null;
  for (const spec of REMOTE_SPECS) {
    const full = `--${spec.name}`;
    if (arg === full) return { spec, inlineValue: null };
    if (arg.startsWith(full + '=')) return { spec, inlineValue: arg.slice(full.length + 1) };
  }
  return null;
}

function consumeRemoteValue(
  arg: string,
  argv: readonly string[],
  index: number,
  spec: RemoteSpec,
  consume: (value: string) => void,
  inlineValue: string | null,
): number {
  if (inlineValue !== null) {
    consume(inlineValue);
    return index + 1;
  }
  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`--${spec.name} requires a value`);
  }
  consume(next);
  return index + 2;
}

function applyRemoteValue(
  bag: ParsedArgs['remoteOptions'],
  spec: RemoteSpec,
  raw: string,
): void {
  if (spec.kind === 'positive') {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`--${spec.name} must be a positive integer, got "${raw}"`);
    }
    (bag as Record<string, number | string | undefined>)[spec.dest] = parsed;
    return;
  }
  (bag as Record<string, number | string | undefined>)[spec.dest] = raw;
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
    `  run [files...]   (default) Run benchmark files locally, or with --remote on the platform.`,
    `  list [files...]  List discovered benchmark files.`,
    ``,
    `Local options:`,
    `  -i, --iterations <n>    iterations per benchmark (default ${DEFAULT_ITERATIONS})`,
    `  -w, --warmup <n>        warmup iterations (default ${DEFAULT_WARMUP})`,
    `  -r, --reporter <fmt>    reporter format: default | json (default default)`,
    `  --bail                  stop on first failure`,
    `  --cwd <path>            working directory`,
    ``,
    `Remote options (combine with --remote):`,
    `  --remote                ship the benchmark to the platform orchestrator`,
    `  --slug <slug>           benchmark slug (default derived from filename)`,
    `  --run-name <name>       run name (default derived from filename)`,
    `  --total <n>             replications per benchmark function (default 100)`,
    `  --workers <n>           local worker processes to fork (default 1; v2 for true remote)`,
    `  --concurrency <n>       parallel task slots per worker (default 1)`,
    `  --participant <slug>    participant identifier (default bench-cli)`,
    `  --api-key <key>         platform API key (default env COMPUTESDK_ADMIN_API_KEY)`,
    `  --base-url <url>        platform base URL (default https://platform.computesdk.com/api/v1)`,
    `  --poll-interval <ms>    parent status poll interval (default 1000)`,
    `  --timeout <seconds>     parent wall-clock timeout (default 0 = unlimited)`,
    ``,
    `General:`,
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

    if (parsed.remote) {
      if (parsed.files.length !== 1) {
        throw new Error('--remote mode requires exactly one benchmark file argument');
      }
      await runRemote(parsed.files[0]!, {
        cwd: parsed.cwd,
        ...parsed.remoteOptions,
      });
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

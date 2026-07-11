import process from 'node:process';
import { readWorkerConfig, runRemoteWorker } from './remote-worker.js';

/**
 * Worker entry point invoked by the parent orchestrator. Reads its
 * configuration from environment variables and runs the task loop until
 * the platform-assigned range is drained.
 */
export async function runWorkerFromArgv(argv: readonly string[]): Promise<number> {
  try {
    const file = readFileArg(argv);
    const config = readWorkerConfig(process.env);
    const result = await runRemoteWorker({ file, config });
    process.stdout.write(JSON.stringify({ kind: 'final', ...result }) + '\n');
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`bench-cli remote worker: ${message}\n`);
    return 1;
  }
}

function readFileArg(argv: readonly string[]): string {
  const idx = argv.indexOf('--file');
  if (idx === -1) {
    // Also accept positional file argument.
    const positional = argv.filter((arg) => !arg.startsWith('-') && arg !== '--remote-worker');
    if (positional.length === 0) {
      throw new Error('remote worker requires --file <path>');
    }
    return positional[0]!;
  }
  const value = argv[idx + 1];
  if (!value) {
    throw new Error('remote worker --file requires a value');
  }
  return value;
}

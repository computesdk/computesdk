/**
 * Built bench-worker entry — bundled by tsup into dist/bin/bench-worker.js.
 *
 * Forks from the parent orchestrator with environment variables that
 * identify the run. This entry does not parse CLI flags; it reads its
 * configuration from the environment exclusively.
 */
import { runWorkerFromArgv } from '../remote-worker-entry.js';

const argv = process.argv.slice(2);
void (await runWorkerFromArgv(argv));

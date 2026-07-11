/**
 * Built bench CLI entry point — bundled by tsup into dist/bin/bench.js.
 */
import { runCli } from '../cli.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(here, '..', '..', 'package.json');
let version = '0.0.0';
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  if (typeof pkg.version === 'string') version = pkg.version;
} catch {
  // ignore — fall back to default version
}

const argv = process.argv.slice(2);
await runCli(argv, version);

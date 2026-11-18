// Refresh the CLI's vendored snapshot engine from an explicit upstream checkout.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const checkout = process.argv[2];
if (!checkout) throw new Error('Usage: node scripts/sync-checkpoint-engine.mjs /path/to/benchmarks-platform [revision]');
const ref = process.argv[3] ?? 'HEAD';
const revision = execFileSync('git', ['-C', checkout, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
const path = 'lib/sandboxes/snapshot-oci-module.cjs';
const source = execFileSync('git', ['-C', checkout, 'show', `${revision}:${path}`]);
const root = fileURLToPath(new URL('../packages/cli/', import.meta.url));
writeFileSync(root + 'checkpoint.cjs', source);
writeFileSync(root + 'checkpoint-provenance.json', JSON.stringify({
  repository: 'https://github.com/computesdk/benchmarks-platform', revision, path,
  sha256: createHash('sha256').update(source).digest('hex'),
}, null, 2) + '\n');
console.log(`Pinned platform checkpoint engine at ${revision}.`);

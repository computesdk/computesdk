#!/usr/bin/env node
/**
 * Bump each provider adapter's upstream SDK dependency to its latest npm release
 * and write a patch changeset for every adapter that changed.
 *
 * Scope: published packages under packages/* that depend on @computesdk/provider.
 * Only `dependencies` with plain semver specs are touched; workspace:, npm:,
 * git/URL and range specs are left alone, as are the shared utilities in SKIP.
 *
 * Spec style is preserved: ^x.y.z -> ^latest, ~x.y.z -> ~latest, exact -> exact.
 * Never downgrades (e.g. a prerelease pin ahead of the `latest` dist-tag).
 *
 * BUMP_SCOPE selects which bumps to apply, so they can ship through separate PRs:
 *   compatible (default) — latest stays caret-compatible with the current version
 *                          (same major, or same minor/patch on 0.x) and keeps
 *                          the same `engines.node` requirement
 *   breaking             — latest crosses that boundary and needs a human review
 *
 * Writes a markdown report to $BUMP_REPORT (default: stdout only).
 * Exits 0 with no edits when everything is already current.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['dotenv', 'playwright-core', 'nanoid', 'ms']);
const SCOPE = process.env.BUMP_SCOPE ?? 'compatible';
if (SCOPE !== 'compatible' && SCOPE !== 'breaking') throw new Error(`Unknown BUMP_SCOPE: ${SCOPE}`);
const SPEC = /^([\^~]?)(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

const cache = new Map();
async function manifest(name, version) {
  const key = `${name}@${version}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const res = await fetch(
        `https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) throw new Error(`npm registry ${res.status} for ${key}`);
      return res.json();
    })());
  }
  return cache.get(key);
}

function compare(a, b) {
  const [coreA, preA] = a.split('-', 2);
  const [coreB, preB] = b.split('-', 2);
  const pa = coreA.split('.').map(Number);
  const pb = coreB.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA.localeCompare(preB, undefined, { numeric: true });
}

function isCompatible(from, to) {
  const [a0, a1, a2] = from.split('-')[0].split('.').map(Number);
  const [b0, b1, b2] = to.split('-')[0].split('.').map(Number);
  if (a0 !== b0) return false;
  if (a0 > 0) return true;
  if (a1 !== b1) return false;
  return a1 > 0 || a2 === b2;
}

const changes = [];
const bumpedPackages = [];

for (const dir of readdirSync('packages').sort()) {
  const path = join('packages', dir, 'package.json');
  if (!existsSync(path)) continue;
  const raw = readFileSync(path, 'utf8');
  const pkg = JSON.parse(raw);
  const deps = pkg.dependencies ?? {};
  if (pkg.private || !deps['@computesdk/provider']) continue;

  let changed = false;
  for (const [name, spec] of Object.entries(deps)) {
    const match = SPEC.exec(spec);
    if (!match || SKIP.has(name)) continue;
    const [, prefix, current] = match;
    const { version: latest, engines } = await manifest(name, 'latest');
    if (compare(latest, current) <= 0) continue;
    const compatible = isCompatible(current, latest) &&
      engines?.node === (await manifest(name, current)).engines?.node;
    if (compatible !== (SCOPE === 'compatible')) continue;
    deps[name] = `${prefix}${latest}`;
    changes.push({ pkg: pkg.name, name, from: spec, to: deps[name] });
    changed = true;
  }

  if (changed) {
    const indent = /^(\s+)"/m.exec(raw)?.[1] ?? '  ';
    writeFileSync(path, JSON.stringify(pkg, null, indent) + '\n');
    bumpedPackages.push(pkg.name);
  }
}

if (bumpedPackages.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const frontmatter = bumpedPackages.map(name => `"${name}": patch`).join('\n');
  const lines = changes.map(c => `- ${c.pkg}: \`${c.name}\` ${c.from} -> ${c.to}`).join('\n');
  writeFileSync(
    join('.changeset', `provider-sdk-${SCOPE}-bump-${stamp}.md`),
    `---\n${frontmatter}\n---\n\nBump provider SDKs to their latest npm releases:\n\n${lines}\n`,
  );
}

const report = changes.length
  ? `Bumped ${changes.length} provider SDK dependencies (${SCOPE} releases) across ${bumpedPackages.length} packages.\n\n| Package | Dependency | From | To |\n|---|---|---|---|\n` +
    changes.map(c => `| \`${c.pkg}\` | \`${c.name}\` | \`${c.from}\` | \`${c.to}\` |`).join('\n') +
    `\n\nA patch changeset is included for each bumped package. Skipped shared utilities: ${[...SKIP].join(', ')}.`
  : `No ${SCOPE} provider SDK releases to apply.`;

if (process.env.BUMP_REPORT) writeFileSync(process.env.BUMP_REPORT, report + '\n');
console.log(report);

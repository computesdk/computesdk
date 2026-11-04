#!/usr/bin/env node
// Static compiler checks only: never import adapters or execute their tests.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, loadProfiles } from './compute-conformance.mjs';

export function planComputeTypechecks(root = ROOT) {
  const profiles = loadProfiles(root);
  if (!profiles.length) throw new Error('Compute typecheck manifest must not be empty');
  const packages = new Map();
  const names = new Set();
  for (const profile of profiles) {
    const directory = profile.packageDirectory;
    if (!/^packages\/[a-z0-9][a-z0-9-]*$/.test(directory)) {
      throw new Error('Compute typechecks require a package-local directory');
    }
    if (packages.has(directory)) {
      packages.get(directory).profileIds.push(profile.id);
      continue;
    }
    const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'));
    if (!/^@computesdk\/[a-z0-9][a-z0-9-]*$/.test(manifest.name) || names.has(manifest.name)) {
      throw new Error('Compute typechecks require unique exact workspace package names');
    }
    names.add(manifest.name);
    const config = ['tsconfig.typecheck.json', 'tsconfig.json']
      .find(file => existsSync(resolve(root, directory, file)));
    if (!config || !statSync(resolve(root, directory, config)).isFile()) {
      throw new Error(`Missing package-local TypeScript config: ${directory}`);
    }
    packages.set(directory, {
      packageName: manifest.name,
      packageDirectory: directory,
      config,
      profileIds: [profile.id],
      command: 'pnpm',
      args: ['--filter', manifest.name, '--fail-if-no-match', 'exec',
        'tsc', '--noEmit', '-p', config, '--pretty', 'false'],
    });
  }
  return {
    profileCount: profiles.length,
    packageCount: packages.size,
    packages: [...packages.values()].sort((a, b) => a.packageDirectory.localeCompare(b.packageDirectory)),
  };
}

// Sequential on purpose: collect every package failure without competing builds.
export function runComputeTypechecks(plan, { root = ROOT, runCommand = spawnSync, log = console.log } = {}) {
  const results = [];
  let exitCode = 0;
  log(`Static TypeScript only: ${plan.profileCount} profiles / ${plan.packageCount} packages; not native proof.`);
  for (const entry of plan.packages) {
    log(`Typechecking ${entry.packageName} (${entry.config})`);
    let result;
    try {
      result = runCommand(entry.command, entry.args, { cwd: root, stdio: 'inherit', shell: false });
    } catch {
      result = { status: null };
    }
    const status = result?.error || result?.signal || !Number.isInteger(result?.status) ||
      result.status < 0 || result.status > 255 ? 1 : result.status;
    if (!exitCode && status) exitCode = status;
    results.push({ packageName: entry.packageName, profileIds: entry.profileIds, exitCode: status });
    log(`${status ? 'FAIL' : 'PASS'} ${entry.packageName} (exit ${status})`);
  }
  const failed = results.filter(result => result.exitCode !== 0).length;
  log(`Compute static typechecks: ${results.length - failed} passed, ${failed} failed; not native proof.`);
  return { profileCount: plan.profileCount, packageCount: plan.packageCount,
    passed: results.length - failed, failed, results, exitCode };
}

export function main(args = process.argv.slice(2), options = {}) {
  if (args.length && !(args.length === 1 && args[0] === '--plan')) {
    throw new Error('Usage: node scripts/typecheck-compute-providers.mjs [--plan]');
  }
  const plan = planComputeTypechecks(options.root ?? ROOT);
  if (args[0] === '--plan') {
    (options.log ?? console.log)(JSON.stringify(plan, null, 2));
    return 0;
  }
  return runComputeTypechecks(plan, options).exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`Compute static typecheck planning failed: ${error.message}`);
    process.exitCode = 1;
  }
}

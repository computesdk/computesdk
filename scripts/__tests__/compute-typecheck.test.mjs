import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { ROOT } from '../compute-conformance.mjs';
import { planComputeTypechecks, runComputeTypechecks, main } from '../typecheck-compute-providers.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'compute-typecheck-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(file, value) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  }
  const profiles = [
    { id: '@computesdk/aws/agentcore', packageDirectory: 'packages/aws', exportSubpath: './agentcore', readiness: 'blocked' },
    { id: '@computesdk/aws/ec2', packageDirectory: 'packages/aws', exportSubpath: './ec2', readiness: 'wired' },
    { id: '@computesdk/fixture', packageDirectory: 'packages/fixture', exportSubpath: '.', readiness: 'wired' },
  ].map(p => ({ ...p, symbol: 'fixture', requiredEnvironment: [], optionalEnvironment: [],
    configEnvironment: {}, config: {}, sourceEvidence: [],
    suite: { supportsFilesystem: false, supportsGetUrl: false, supportsBackground: false },
    cleanup: { status: 'needs-review', reason: 'No native execution authorized.' } }));
  const inventory = profiles.map(p => ({
    id: p.id, symbol: p.symbol, kind: 'compute', review: { status: 'included' },
  }));
  function save() {
    write('conformance/compute-profiles.json', { schemaVersion: 1, profiles });
    write('conformance/providers.json', { schemaVersion: 1, providers: inventory });
  }
  for (const name of ['aws', 'fixture']) {
    write(`packages/${name}/package.json`, { name: `@computesdk/${name}` });
    write(`packages/${name}/tsconfig.json`, { include: ['src/**/*'] });
    // A planner/runner test must not execute package source or test code.
    write(`packages/${name}/src/index.ts`, "throw new Error('Adapter source must not execute');");
    write(`packages/${name}/src/__tests__/index.test.ts`, "throw new Error('Provider tests must not execute');");
  }
  save();
  return { root, write, profiles, inventory, save };
}

test('plan covers every canonical profile, deduplicates AWS, and ignores native readiness/cleanup holds', t => {
  const f = fixture(t);
  const plan = planComputeTypechecks(f.root);
  assert.equal(plan.profileCount, 3);
  assert.equal(plan.packageCount, 2);
  assert.deepEqual(plan.packages[0].profileIds, ['@computesdk/aws/agentcore', '@computesdk/aws/ec2']);
  assert.deepEqual(plan.packages.map(p => p.packageName), ['@computesdk/aws', '@computesdk/fixture']);
  for (const entry of plan.packages) {
    assert.equal(entry.command, 'pnpm');
    assert.deepEqual(entry.args, ['--filter', entry.packageName, '--fail-if-no-match',
      'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false']);
  }
});

test('explicit test config wins over production config; no root config fallback', t => {
  const f = fixture(t);
  f.write('packages/fixture/tsconfig.typecheck.json', { extends: './tsconfig.json' });
  const entry = planComputeTypechecks(f.root).packages[1];
  assert.equal(entry.config, 'tsconfig.typecheck.json');
  assert.equal(entry.args[entry.args.indexOf('-p') + 1], entry.config);
  rmSync(resolve(f.root, 'packages/aws/tsconfig.json'));
  f.write('tsconfig.json', { include: ['**/*'] });
  assert.throws(() => planComputeTypechecks(f.root), /Missing package-local TypeScript config/);
});

for (const [label, mutate] of [
  ['missing compute manifest', f => rmSync(resolve(f.root, 'conformance/compute-profiles.json'))],
  ['missing inventory', f => rmSync(resolve(f.root, 'conformance/providers.json'))],
  ['missing package manifest', f => rmSync(resolve(f.root, 'packages/aws/package.json'))],
  ['invalid JSON', f => f.write('conformance/compute-profiles.json', '{')],
  ['omitted canonical profile', f => { f.profiles.pop(); f.save(); }],
  ['duplicate canonical profile', f => { f.profiles.push(f.profiles[0]); f.save(); }],
  ['empty manifest and inventory', f => { f.profiles.length = 0; f.inventory.length = 0; f.save(); }],
  ['invalid package identity', f => f.write('packages/aws/package.json', { name: '@computesdk/other' })],
  ['non-file preferred config', f => mkdirSync(resolve(f.root, 'packages/aws/tsconfig.typecheck.json'))],
]) {
  test(`planning fails closed before any command: ${label}`, t => {
    const f = fixture(t);
    mutate(f);
    let calls = 0;
    assert.throws(() => main([], { root: f.root, runCommand() { calls++; } }));
    assert.equal(calls, 0);
  });
}

test('unsafe package path and pnpm filter metacharacters are rejected', t => {
  const f = fixture(t);
  f.profiles[2].packageDirectory = 'packages/../escape';
  f.write('escape/package.json', { name: '@computesdk/fixture' });
  f.save();
  assert.throws(() => planComputeTypechecks(f.root), /package-local directory/);
  f.profiles[2].packageDirectory = 'packages/fixture';
  f.profiles[2].id = '@computesdk/*';
  f.inventory[2].id = '@computesdk/*';
  f.write('packages/fixture/package.json', { name: '@computesdk/*' });
  f.save();
  assert.throws(() => planComputeTypechecks(f.root), /exact workspace package names/);
});

test('fake runner collects all results sequentially and preserves first nonzero command exit', t => {
  const f = fixture(t);
  const calls = [];
  const result = runComputeTypechecks(planComputeTypechecks(f.root), {
    root: f.root, log() {},
    runCommand(command, args, options) {
      calls.push({ command, args, options });
      return { status: calls.length === 1 ? 7 : 2 };
    },
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.command === 'pnpm' && call.options.cwd === f.root &&
    call.options.shell === false && call.options.stdio === 'inherit'));
  assert.equal(result.failed, 2);
  assert.equal(result.passed, 0);
  assert.equal(result.exitCode, 7);
  assert.deepEqual(result.results.map(r => r.exitCode), [7, 2]);
});

for (const [label, failed] of [
  ['zero package matches (pnpm fail-if-no-match)', () => ({ status: 1 })],
  ['killed compiler', () => ({ status: null, signal: 'SIGTERM' })],
  ['missing pnpm', () => ({ status: null, error: new Error('ENOENT') })],
  ['runner throws', () => { throw new Error('spawn failed'); }],
  ['no result', () => undefined],
]) {
  test(`command failure cannot become success: ${label}`, t => {
    const f = fixture(t);
    let calls = 0;
    const result = runComputeTypechecks(planComputeTypechecks(f.root), {
      root: f.root, log() {},
      runCommand() { return ++calls === 1 ? failed() : { status: 0 }; },
    });
    assert.equal(calls, 2, 'remaining package still checked');
    assert.equal(result.exitCode, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.passed, 1);
  });
}

test('plan-only and successful CLI path use injected runners, not real package commands', t => {
  const f = fixture(t);
  const output = [];
  assert.equal(main(['--plan'], { root: f.root, log: line => output.push(line),
    runCommand() { assert.fail('plan must not execute commands'); } }), 0);
  assert.equal(JSON.parse(output[0]).profileCount, 3);
  assert.equal(main([], { root: f.root, log() {}, runCommand() { return { status: 0 }; } }), 0);
  assert.equal(main([], { root: f.root, log() {}, runCommand() { return { status: 9 }; } }), 9);
  assert.throws(() => main(['--provider', 'fixture'], { root: f.root }), /Usage/);
});

test('repository plan includes all 55 canonical profiles in 54 explicit package commands', () => {
  const plan = planComputeTypechecks(ROOT);
  assert.equal(plan.profileCount, 55);
  assert.equal(plan.packageCount, 54);
  assert.equal(new Set(plan.packages.flatMap(p => p.profileIds)).size, 55);
  assert.equal(plan.packages.find(p => p.packageName === '@computesdk/aws').profileIds.length, 2);
  for (const name of ['collimate', 'givemeanode']) {
    assert.equal(plan.packages.find(p => p.packageName === `@computesdk/${name}`).config,
      'tsconfig.typecheck.json');
  }
});

test('new test-only configs restore all excluded test scope without changing production emit configs', () => {
  for (const name of ['collimate', 'givemeanode']) {
    const config = JSON.parse(readFileSync(resolve(ROOT, `packages/${name}/tsconfig.typecheck.json`), 'utf8'));
    assert.equal(config.extends, './tsconfig.json');
    assert.equal(config.compilerOptions.noEmit, true);
    assert.deepEqual(config.include, ['src/**/*']);
    assert.deepEqual(config.exclude, ['node_modules', 'dist']);
    assert.deepEqual(Object.keys(config.compilerOptions).sort(),
      name === 'givemeanode' ? ['allowImportingTsExtensions', 'module', 'noEmit'] : ['noEmit']);
    if (name === 'givemeanode') {
      assert.equal(config.compilerOptions.allowImportingTsExtensions, true);
      assert.equal(config.compilerOptions.module, 'ES2022', 'Node test import.meta must be typechecked');
    }
    const production = JSON.parse(readFileSync(resolve(ROOT, `packages/${name}/tsconfig.json`), 'utf8'));
    assert.ok(production.exclude.includes(name === 'collimate' ? '**/*.test.ts' : 'src/**/*.node.test.ts'));
    assert.equal(production.compilerOptions.noEmit, undefined);
  }
});

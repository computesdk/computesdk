/**
 * Offline end-to-end checks: execute the real loader and CI run blocks with
 * synthetic nsc/pnpm executables. No provider or vault credentials are used.
 *
 * Failure surfaces: authentication/version/list/export errors, malformed or
 * deleted entries, duplicate labels, missing/empty E2B keys, accidental
 * unrelated-secret exports, skipped test commands, token-file overwrite,
 * and fork PRs receiving vault-capable runners.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = () => readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

function runBlock(name, occurrence = 0) {
  const lines = workflow().split('\n');
  const indexes = lines.flatMap((line, i) => line.trim() === `- name: ${name}` ? [i] : []);
  assert.ok(indexes.length > occurrence, `missing CI step ${name}`);
  const start = indexes[occurrence];
  const indent = lines[start].search(/\S/);
  let end = start + 1;
  while (end < lines.length && !(lines[end].trim() && lines[end].search(/\S/) <= indent)) end++;
  const block = lines.slice(start + 1, end);
  const run = block.findIndex(line => line.trim() === 'run: |');
  assert.notEqual(run, -1, `missing run block in ${name}`);
  const bodyIndent = block[run].search(/\S/) + 2;
  return block.slice(run + 1).map(line => line.slice(bodyIndent)).join('\n');
}

function fixture(t, mode = 'ok', entries) {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-vault-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ['bin', 'tmp', 'home']) mkdirSync(join(dir, path));
  writeFileSync(join(dir, 'vault.json'), JSON.stringify(entries ?? [
    { object_id: 'old', labels: [{ name: 'name', value: 'E2B_API_KEY' }] },
    { object_id: 'other', labels: [{ name: 'name', value: 'UNRELATED_SECRET' }] },
    { object_id: 'new', labels: [{ name: 'name', value: 'E2B_API_KEY' }] },
    { object_id: 'deleted', labels: [{ name: 'name', value: 'E2B_API_KEY' }], deleted_at: '2026-01-01' },
  ]));
  const executable = (name, body) => writeFileSync(join(dir, 'bin', name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  executable('nsc', `
    const fs = require('node:fs'), path = require('node:path');
    const d = process.env.FIXTURE, args = process.argv.slice(2), mode = process.env.FIXTURE_MODE;
    fs.appendFileSync(path.join(d, 'nsc-calls'), args.slice(0, 2).join(' ') + '\\n');
    if (args[0] === 'version') process.exit(mode === 'version-fail' ? 1 : 0);
    if (args[1] === 'list') {
      if (mode === 'list-fail') process.exit(1);
      process.stdout.write(mode === 'malformed' ? 'not-json' : fs.readFileSync(path.join(d, 'vault.json')));
    } else if (args[1] === 'export') {
      if (mode === 'export-fail') process.exit(1);
      const envdef = fs.readFileSync(args[args.indexOf('--envdef') + 1], 'utf8');
      for (const line of envdef.trim().split('\\n')) {
        const [key, id] = line.split('=');
        if (mode === 'empty-export') continue;
        const value = id === 'new' ? 'fixture-e2b-secret' : id === 'old' ? 'stale-secret' : 'unrelated-secret';
        console.log('export ' + key + '=' + JSON.stringify(value));
      }
    } else process.exit(2);
  `);
  executable('pnpm', `
    const fs = require('node:fs'), path = require('node:path');
    fs.appendFileSync(path.join(process.env.FIXTURE, 'test-commands'), process.argv.slice(2).join(' ') + '\\n');
    if (process.env.E2B_API_KEY !== 'fixture-e2b-secret') process.exit(42);
  `);
  const env = {
    PATH: `${join(dir, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(dir, 'home'), TMPDIR: join(dir, 'tmp'),
    FIXTURE: dir, FIXTURE_MODE: mode, TEST_PROVIDER: 'e2b',
    GITHUB_ENV: join(dir, 'github-env'),
  };
  return { dir, env, run: (body, extra = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', body], {
    cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 15_000,
  }) };
}

test('the sourced loader exports only the newest active requested key and masks it', t => {
  const f = fixture(t);
  const r = f.run(`
    . scripts/load-vault-secrets.sh '^(E2B_API_KEY)='
    test "$E2B_API_KEY" = fixture-e2b-secret
    test -z "\${UNRELATED_SECRET:-}"
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /duplicates=1 deleted=1/);
  assert.match(r.stdout, /::add-mask::fixture-e2b-secret/);
  assert.ok(!r.stdout.includes('unrelated-secret'));
  const ordinaryOutput = r.stdout.split('\n').filter(line => !line.startsWith('::add-mask::')).join('\n');
  assert.ok(!ordinaryOutput.includes('fixture-e2b-secret'));
  assert.ok(!existsSync(join(f.dir, 'github-env')), 'exports must reach the current shell without a GITHUB_ENV bridge');
});

test('description fallback works when the Namespace object has no name label', t => {
  const f = fixture(t, 'ok', [{ object_id: 'new', description: 'E2B_API_KEY' }]);
  const r = f.run(`. scripts/load-vault-secrets.sh '^(E2B_API_KEY)='; test "$E2B_API_KEY" = fixture-e2b-secret`);
  assert.equal(r.status, 0, r.stderr);
});

const e2bSteps = [
  ['Run E2B Integration Tests', '--filter @computesdk/e2b test'],
  ['Run ComputeSDK Integration Test (${{ matrix.provider }})', '--filter computesdk test compute-provider-integration'],
];

for (const [name, command] of e2bSteps) {
  test(`${name}: loads the key in the same shell and executes the existing test command`, t => {
    const f = fixture(t);
    const r = f.run(runBlock(name), { E2B_API_KEY: 'stale-actions-value' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(f.dir, 'test-commands'), 'utf8').trim(), command);
  });
  for (const mode of ['version-fail', 'list-fail', 'export-fail', 'empty-export', 'malformed']) {
    test(`${name}: ${mode} fails rather than running tests or green-skipping`, t => {
      const f = fixture(t, mode);
      const r = f.run(runBlock(name), { E2B_API_KEY: 'stale-actions-value' });
      assert.notEqual(r.status, 0);
      assert.ok(!existsSync(join(f.dir, 'test-commands')));
    });
  }
  for (const entries of [
    [],
    [{ object_id: 'deleted', description: 'E2B_API_KEY', deleted_at: '2026-01-01' }],
    [{ object_id: 'other', description: 'COMPUTESDK_API_KEY' }],
  ]) {
    test(`${name}: missing required E2B key fails even if another key exists`, t => {
      const f = fixture(t, 'ok', entries);
      const r = f.run(runBlock(name), { E2B_API_KEY: 'stale-actions-value' });
      assert.notEqual(r.status, 0);
      assert.ok(!existsSync(join(f.dir, 'test-commands')));
    });
  }
}

test('both integration jobs use the same token bootstrap', () => {
  assert.equal(runBlock('Seed Namespace token file', 0), runBlock('Seed Namespace token file', 1));
});

for (const [name, token] of [
  ['raw bearer', 'fixture-namespace-token'],
  ['JSON document', '{"bearer_token":"fixture-namespace-token"}'],
]) {
  test(`Namespace bootstrap accepts ${name}, writes privately, and never prints it`, t => {
    const f = fixture(t);
    const body = runBlock('Seed Namespace token file').replaceAll('/var/run/nsc', join(f.dir, 'nsc'));
    const r = f.run(body, { NSC_TOKEN: token });
    assert.equal(r.status, 0, r.stderr);
    const path = join(f.dir, 'nsc/token.json');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).bearer_token, 'fixture-namespace-token');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.ok(!`${r.stdout}${r.stderr}`.includes('fixture-namespace-token'));
    assert.match(readFileSync(f.env.GITHUB_ENV, 'utf8'), /NSC_DOCKER_LOGIN=1/);
  });
}

test('Namespace bootstrap preserves an existing runner token instead of overwriting it', t => {
  const f = fixture(t);
  mkdirSync(join(f.dir, 'nsc'));
  writeFileSync(join(f.dir, 'nsc/token.json'), '{"bearer_token":"runner-token"}', { mode: 0o600 });
  const r = f.run(runBlock('Seed Namespace token file').replaceAll('/var/run/nsc', join(f.dir, 'nsc')), { NSC_TOKEN: 'do-not-overwrite' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'nsc/token.json'), 'utf8')).bearer_token, 'runner-token');
});

test('Namespace bootstrap fails clearly when neither a runner token nor NSC_TOKEN exists', t => {
  const f = fixture(t);
  const r = f.run(runBlock('Seed Namespace token file').replaceAll('/var/run/nsc', join(f.dir, 'nsc')));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /Namespace.*(token|authentication)/i);
});

test('vault-enabled integration jobs retain PR gates and refuse fork code', () => {
  const w = workflow();
  for (const name of ['provider-integration-tests', 'computesdk-integration-tests']) {
    const block = w.split(`  ${name}:`)[1]?.split(/\n  [a-z][\w-]*:/)[0];
    assert.ok(block);
    assert.match(block, /github\.event_name == 'pull_request'/);
    assert.match(block, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
    assert.match(block, /permissions:\s+contents: read\s+id-token: write/);
    assert.match(block, /permissions\.additional_grant=vault\/object:\*:reveal/);
  }
});

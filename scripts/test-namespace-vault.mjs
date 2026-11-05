/**
 * Offline end-to-end checks: execute the real loader and CI run blocks with
 * synthetic nsc/pnpm executables. No provider or vault credentials are used.
 *
 * Failure surfaces: authentication/version/list/export errors, malformed or
 * deleted entries, duplicate labels, missing/empty provider keys, accidental
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
const registry = JSON.parse(readFileSync(join(root, 'scripts/integration-providers.json'), 'utf8'));
const providers = Object.fromEntries(Object.entries(registry).map(([name, config]) => [name, config.requiredEnv]));
const aliases = Object.assign({}, ...Object.values(registry).map(config => config.aliases ?? {}));
const aliasKeys = Object.values(aliases).flat();
const allKeys = [...new Set([
  ...Object.values(providers).flat(),
  ...Object.values(registry).flatMap(config => config.optionalEnv ?? []),
  ...aliasKeys, 'COMPUTESDK_API_KEY', 'UNRELATED_SECRET',
])];
const valueFor = key => key === 'E2B_API_KEY' ? 'fixture-e2b-secret' : `fixture-${key.toLowerCase()}-secret`;
const entriesFor = keys => keys.map(key => ({ object_id: key, labels: [{ name: 'name', value: key }] }));

function jobBlock(name) {
  const block = workflow().split(`  ${name}:`)[1]?.split(/\n  [a-z][\w-]*:/)[0];
  assert.ok(block, `missing CI job ${name}`);
  return block;
}

function stepBlock(name, occurrence = 0) {
  const lines = workflow().split('\n');
  const indexes = lines.flatMap((line, i) => line.trim() === `- name: ${name}` ? [i] : []);
  assert.ok(indexes.length > occurrence, `missing CI step ${name}`);
  const start = indexes[occurrence];
  const indent = lines[start].search(/\S/);
  let end = start + 1;
  while (end < lines.length && !(lines[end].trim() && lines[end].search(/\S/) <= indent)) end++;
  return lines.slice(start + 1, end);
}

function runBlock(name, occurrence = 0) {
  const block = stepBlock(name, occurrence);
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
  writeFileSync(join(dir, 'values.json'), JSON.stringify({
    ...Object.fromEntries(allKeys.map(key => [key, valueFor(key)])),
    new: 'fixture-e2b-secret', old: 'stale-secret', other: 'unrelated-secret',
  }));
  const executable = (name, body) => writeFileSync(join(dir, 'bin', name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  executable('nsc', `
    const fs = require('node:fs'), path = require('node:path');
    const d = process.env.FIXTURE, args = process.argv.slice(2), mode = process.env.FIXTURE_MODE;
    fs.appendFileSync(path.join(d, 'nsc-calls'), args.slice(0, 2).join(' ') + '\\n');
    if (args[0] === 'version') process.exit(mode === 'version-fail' ? 1 : 0);
    if (args[1] === 'list') {
      if (mode === 'auth-fail') {
        console.error('Namespace authentication failed');
        process.exit(1);
      }
      if (mode === 'list-fail') process.exit(1);
      process.stdout.write(mode === 'malformed' ? 'not-json' : fs.readFileSync(path.join(d, 'vault.json')));
    } else if (args[1] === 'export') {
      if (mode === 'export-fail') process.exit(1);
      if (mode === 'malformed-export') {
        console.log('export (not valid bash');
        process.exit(0);
      }
      const envdef = fs.readFileSync(args[args.indexOf('--envdef') + 1], 'utf8');
      fs.appendFileSync(path.join(d, 'requested-keys'), envdef);
      const values = JSON.parse(fs.readFileSync(path.join(d, 'values.json'), 'utf8'));
      for (const line of envdef.trim().split('\\n')) {
        const [key, id] = line.split('=');
        if (mode === 'empty-export') continue;
        const value = mode === 'empty-value:' + key ? '' : values[id] ?? 'unrelated-secret';
        console.log('export ' + key + '=' + JSON.stringify(value));
      }
    } else process.exit(2);
  `);
  executable('pnpm', `
    const fs = require('node:fs'), path = require('node:path');
    fs.appendFileSync(path.join(process.env.FIXTURE, 'test-commands'), process.argv.slice(2).join(' ') + '\\n');
    const expected = JSON.parse(process.env.FIXTURE_EXPECTED || '{"E2B_API_KEY":"fixture-e2b-secret"}');
    for (const [key, value] of Object.entries(expected)) {
      if (process.env[key] !== value) {
        console.error('Unexpected credential environment for ' + key);
        process.exit(42);
      }
    }
    for (const key of JSON.parse(process.env.FIXTURE_FORBIDDEN || '[]')) {
      if (Object.hasOwn(process.env, key)) {
        console.error('Unexpected unrelated credential ' + key);
        process.exit(43);
      }
    }
  `);
  const env = {
    PATH: `${join(dir, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(dir, 'home'), TMPDIR: join(dir, 'tmp'), PS1: '',
    FIXTURE: dir, FIXTURE_MODE: mode, TEST_PROVIDER: 'e2b',
    GITHUB_ENV: join(dir, 'github-env'),
  };
  return { dir, env, run: (body, extra = {}) => spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', body], {
    cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000,
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

const integrationSteps = [
  { mode: 'provider', name: 'Run Provider Integration Tests (${{ matrix.provider }})', providers: Object.keys(providers).filter(provider => provider !== 'platform') },
  { mode: 'core', name: 'Run ComputeSDK Integration Test (${{ matrix.provider }})', providers: Object.keys(providers) },
];

function integrationEnv(provider, mode, keys = providers[provider], expected = {}) {
  const requested = [...providers[provider], ...(registry[provider].optionalEnv ?? []), ...Object.values(registry[provider].aliases ?? {}).flat()];
  if (mode === 'provider' && provider !== 'archil') requested.push('COMPUTESDK_API_KEY');
  return {
    TEST_PROVIDER: provider,
    ...Object.fromEntries(requested.map(key => [key, 'stale-actions-value'])),
    FIXTURE_EXPECTED: JSON.stringify({
      ...Object.fromEntries(keys.map(key => [key, valueFor(key)])),
      TEST_PROVIDER_PACKAGE: registry[provider].package,
      ...expected,
    }),
    FIXTURE_FORBIDDEN: JSON.stringify(allKeys.filter(key => !requested.includes(key))),
  };
}

function assertNoTests(f, r) {
  assert.notEqual(r.status, 0, `expected failure, got stdout: ${r.stdout}`);
  assert.ok(!r.error, r.error?.message);
  assert.ok(!existsSync(join(f.dir, 'test-commands')), 'credential failure must prevent running pnpm');
}

for (const { mode, name, providers: matrix } of integrationSteps) {
  for (const provider of matrix) {
    const required = providers[provider];
    const sdkOptional = mode === 'provider' && provider !== 'archil' ? ['COMPUTESDK_API_KEY'] : [];
    const optional = [...(registry[provider].optionalEnv ?? []), ...sdkOptional];
    const command = mode === 'provider' ? `--filter ${registry[provider].package} test` : '--filter computesdk test compute-provider-integration';
    const label = `${mode}/${provider}`;

    test(`${label}: loads only its vault keys in the same shell and runs the unchanged command`, t => {
      // Include every other provider's secrets to exercise the allowlist.
      const f = fixture(t, 'ok', entriesFor(allKeys.filter(key => !aliasKeys.includes(key))));
      const r = f.run(runBlock(name), integrationEnv(provider, mode, [...required, ...optional]));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(join(f.dir, 'test-commands'), 'utf8').trim(), command);
      const requested = readFileSync(join(f.dir, 'requested-keys'), 'utf8').trim().split('\n').map(line => line.split('=')[0]);
      assert.deepEqual(requested.sort(), [...required, ...optional].sort());
      assert.ok(!existsSync(join(f.dir, 'github-env')), 'credentials must not use GITHUB_ENV');
      for (const key of [...required, ...optional]) {
        assert.match(r.stdout, new RegExp(`::add-mask::${valueFor(key)}`));
      }
      const ordinaryOutput = `${r.stdout}\n${r.stderr}`.split('\n').filter(line => !line.startsWith('::add-mask::')).join('\n');
      for (const key of allKeys) assert.ok(!ordinaryOutput.includes(valueFor(key)), `unmasked secret output for ${key}`);
    });

    // Transport/parser behavior belongs to the shared loader; exercise it in
    // both job modes without repeating it for every registry entry.
    for (const failure of provider === 'e2b' ? ['version-fail', 'auth-fail', 'list-fail', 'export-fail', 'empty-export', 'malformed', 'malformed-export'] : []) {
      test(`${label}: ${failure} fails closed even with inherited credentials`, t => {
        const f = fixture(t, failure, entriesFor([...required, ...optional]));
        assertNoTests(f, f.run(runBlock(name), integrationEnv(provider, mode)));
      });
    }

    for (const key of required) {
      test(`${label}: missing ${key} fails even with its stale canonical/alias environment and other vault entries`, t => {
        const f = fixture(t, 'ok', entriesFor(allKeys.filter(candidate => candidate !== key && !(aliases[key] ?? []).includes(candidate))));
        const r = f.run(runBlock(name), integrationEnv(provider, mode));
        assertNoTests(f, r);
        assert.match(r.stderr + r.stdout, /(missing|did not supply|empty after filtering)/i);
      });

      test(`${label}: empty ${key} fails even with its inherited value`, t => {
        const f = fixture(t, `empty-value:${key}`, entriesFor([...required, ...optional]));
        assertNoTests(f, f.run(runBlock(name), integrationEnv(provider, mode)));
      });
    }

    for (const [state, entries] of provider === 'e2b' ? [
      ['empty', []],
      ['deleted-only', entriesFor(required).map(entry => ({ ...entry, deleted_at: '2026-01-01' }))],
      ['unrelated-only', entriesFor(['UNRELATED_SECRET'])],
    ] : []) {
      test(`${label}: ${state} vault cannot green-skip`, t => {
        const f = fixture(t, 'ok', entries);
        assertNoTests(f, f.run(runBlock(name), integrationEnv(provider, mode)));
      });
    }

    if (optional.length) {
      test(`${label}: absent optional keys are cleared, not required`, t => {
        const f = fixture(t, 'ok', entriesFor(required));
        const env = integrationEnv(provider, mode);
        env.FIXTURE_FORBIDDEN = JSON.stringify([...JSON.parse(env.FIXTURE_FORBIDDEN), ...optional]);
        const r = f.run(runBlock(name), env);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(join(f.dir, 'test-commands'), 'utf8').trim(), command);
      });
    }

    for (const [key, alias] of required.flatMap(key => (aliases[key] ?? []).map(alias => [key, alias]))) {
      test(`${label}: ${alias} alone supplies ${key}, replacing stale inherited canonical credentials`, t => {
        const f = fixture(t, 'ok', entriesFor([...required.filter(candidate => candidate !== key), alias]));
        const r = f.run(runBlock(name), integrationEnv(provider, mode, required, { [key]: valueFor(alias), [alias]: valueFor(alias) }));
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(join(f.dir, 'test-commands'), 'utf8').trim(), command);
      });

      test(`${label}: both alias and canonical present preserve documented precedence`, t => {
        const f = fixture(t, 'ok', entriesFor([...required, alias]));
        const preferred = registry[provider].canonicalFirst ? key : alias;
        const r = f.run(runBlock(name), integrationEnv(provider, mode, required, { [key]: valueFor(preferred), [alias]: valueFor(alias) }));
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(join(f.dir, 'test-commands'), 'utf8').trim(), command);
      });
    }
  }
}

for (const provider of ['e2b']) {
  test(`${provider}: sourcing the provider helper without a mode defaults to core`, t => {
    const required = providers[provider];
    const f = fixture(t, 'ok', entriesFor(allKeys));
    const expected = Object.fromEntries(Object.entries(registry[provider].aliases ?? {})
      .filter(() => !registry[provider].canonicalFirst)
      .map(([key, values]) => [key, valueFor(values[0])]));
    const r = f.run(`
      . scripts/load-provider-vault-secrets.sh "$TEST_PROVIDER"
      pnpm --filter computesdk test compute-provider-integration
    `, integrationEnv(provider, 'core', [...required, ...(registry[provider].optionalEnv ?? [])], expected));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(f.dir, 'test-commands'), 'utf8').trim(), '--filter computesdk test compute-provider-integration');
  });
}

for (const args of ['unknown core', 'e2b unknown', '']) {
  test(`provider helper rejects invalid arguments ${JSON.stringify(args)} before accessing the vault`, t => {
    const f = fixture(t);
    const r = f.run(`. scripts/load-provider-vault-secrets.sh ${args}; pnpm test`);
    assertNoTests(f, r);
    assert.ok(!existsSync(join(f.dir, 'nsc-calls')));
  });
}

test('workflow matrices and unconditional Namespace setup cover every supported integration provider', () => {
  const runner = 'namespace-profile-default;permissions.additional_grant=vault/object:*:list;permissions.additional_grant=vault/object:*:describe;permissions.additional_grant=vault/object:*:reveal';
  for (const [i, job] of ['provider-integration-tests', 'computesdk-integration-tests'].entries()) {
    const block = jobBlock(job);
    const step = integrationSteps[i];
    const output = step.mode === 'provider' ? 'providers' : 'coreProviders';
    assert.ok(block.includes(`provider: \${{ fromJSON(needs.test.outputs.${output}) }}`), `${job} must use the registry-generated matrix`);
    assert.equal(block.match(/^\s+runs-on: (.+)$/m)?.[1], runner, 'all matrix providers need the literal vault-enabled profile');
    assert.equal((block.match(/- name: Run .*Integration Test/g) ?? []).length, 1, 'use one generic test step, not provider-specific bypasses');
    for (const name of ['Seed Namespace token file', 'Set up Namespace vault CLI']) {
      const setup = stepBlock(name, i).join('\n');
      assert.doesNotMatch(setup, /^\s*if:/m, 'Namespace setup must not depend on the provider');
      assert.ok(block.includes(`- name: ${name}`));
    }
    assert.match(stepBlock(step.name).join('\n'), /TEST_PROVIDER: \$\{\{ matrix\.provider \}\}/);
    assert.doesNotMatch(stepBlock(step.name).join('\n'), /^\s*if:/m);
    assert.match(runBlock(step.name), new RegExp(`\\. scripts/load-provider-vault-secrets\\.sh "\\$TEST_PROVIDER" ${step.mode}`));
    if (step.mode === 'core') {
      assert.match(stepBlock(step.name).join('\n'), /COMPUTESDK_INTEGRATION: "1"/);
    }
    assert.doesNotMatch(block, /\$\{\{\s*secrets\.(?:E2B_|VERCEL_|DAYTONA_|MODAL_|ARCHIL_|BL_|COMPUTE_PLATFORM_|COMPUTESDK_)/);
  }
});

test('workflow matrix generation includes every registry provider and adds platform only to core', t => {
  const f = fixture(t);
  const output = join(f.dir, 'github-output');
  const r = f.run(runBlock('Build integration matrices'), { GITHUB_OUTPUT: output });
  assert.equal(r.status, 0, r.stderr);
  const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), JSON.parse(line.slice(split + 1))];
  }));
  assert.deepEqual(values.providers, integrationSteps[0].providers.toSorted());
  assert.deepEqual(values.coreProviders, integrationSteps[1].providers.toSorted());
  const job = jobBlock('test');
  assert.match(job, /providers: \$\{\{ steps\.integration-matrix\.outputs\.providers \}\}/);
  assert.match(job, /coreProviders: \$\{\{ steps\.integration-matrix\.outputs\.coreProviders \}\}/);
});

test('registry factory and sandbox configuration references only declared vault environment keys', () => {
  for (const [provider, config] of Object.entries(registry)) {
    assert.ok(config.requiredEnv.length, `${provider} must require credentials rather than silently skip`);
    const declared = [...config.requiredEnv, ...(config.optionalEnv ?? [])];
    for (const key of [...Object.values(config.config), ...Object.values(config.sandboxEnv ?? {})]) {
      assert.ok(declared.includes(key), `${provider} config environment ${key} must be loaded from the vault`);
    }
    for (const key of Object.keys(config.aliases ?? {})) assert.ok(config.requiredEnv.includes(key));
  }
});

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProfiles, selectProfiles, blockedReason, credentialPattern, providerModule,
  sourceFingerprint, acceptedLiveResult, expectedCases, vaultEnvdef, createResourceJournal, reportPath } from '../compute-conformance.mjs';
import { summarizeNative } from '../compute-conformance-reporter.mjs';

const profiles = loadProfiles();
const e2b = profiles.find(p => p.id === '@computesdk/e2b');
const successful = { mode: 'native', nativePassed: 1, nativeFailed: 0, nativeSkipped: 0, failedFiles: 0, unhandledErrors: 0 };
test('catalog covers all 55 canonical compute entries without aliases, browser, storage or Cloud Run', () => {
  assert.equal(profiles.length, 55);
  assert.equal(new Set(profiles.map(p => p.id)).size, 55);
  assert.ok(!profiles.some(p => /cloud-run|browser|tigris/.test(p.id)));
  assert.equal(profiles.filter(p => p.readiness === 'wired').length, 35);
  assert.equal(profiles.filter(p => p.readiness === 'blocked').length, 20);
});
test('selection is exact, including canonical subpaths; all is explicit', () => {
  assert.equal(selectProfiles(profiles, 'e2b')[0], e2b);
  assert.equal(selectProfiles(profiles, e2b.id)[0], e2b);
  assert.equal(selectProfiles(profiles, 'aws/agentcore')[0].exportSubpath, './agentcore');
  assert.equal(selectProfiles(profiles, 'all').length, profiles.length);
  for (const id of ['', 'cloud-run', 'agentcore', 'e2b;echo anything']) {
    assert.throws(() => selectProfiles(profiles, id));
  }
});
test('blocked profiles and missing configuration cannot become native pass', () => {
  assert.equal(blockedReason(profiles.find(p => p.id === '@computesdk/aws/agentcore'), {}), 'needs-reviewed-live-profile');
  assert.equal(blockedReason(e2b, {}), 'missing configuration: E2B_API_KEY');
  assert.equal(blockedReason(e2b, { E2B_API_KEY: 'unit-only-not-a-secret' }), null);
  const beam = profiles.find(p => p.id === '@computesdk/beam');
  assert.equal(blockedReason(beam, { BEAM_TOKEN: 'unit-value', BEAM_WORKSPACE_ID: 'unit-value' }), 'needs-reviewed-cleanup-contract');
  assert.deepEqual(profiles.filter(p => p.cleanup.status === 'source-reviewed-sdk-absence').map(p => p.id).sort(), [
    '@computesdk/blaxel', '@computesdk/e2b', '@computesdk/isorun',
    '@computesdk/neevcloud', '@computesdk/sandbox0', '@computesdk/sprites', '@computesdk/vercel',
  ]);
  const createos = profiles.find(p => p.id === '@computesdk/createos-sandbox');
  assert.equal(createos.cleanup.status, 'source-reviewed-native-terminal');
  assert.equal(createos.cleanup.oracle, 'createos-destroyed-metadata');
  assert.equal(blockedReason(createos, { CREATEOS_SANDBOX_API_KEY: 'unit-value' }), null);
  assert.equal(blockedReason({ ...e2b, cleanup: createos.cleanup }, { E2B_API_KEY: 'unit-value' }),
    'needs-reviewed-cleanup-contract');
});
test('vault selection contains only missing names for the selected provider, never values', () => {
  assert.equal(credentialPattern(e2b, {}), '^(E2B_API_KEY)=$');
  const env = { E2B_API_KEY: 'unit-only-not-a-secret' };
  assert.equal(credentialPattern(e2b, env), '');
  assert.equal(env.E2B_API_KEY, 'unit-only-not-a-secret');
});
test('actual prepare CLI permits both reviewed cleanup modes without credentials, but never blocked modes', () => {
  for (const [id, code, reason] of [
    ['e2b', 0, undefined],
    ['createos-sandbox', 0, undefined],
    ['beam', 2, 'needs-reviewed-cleanup-contract'],
    ['aws/agentcore', 2, 'needs-reviewed-live-profile'],
  ]) {
    const file = reportPath(`@computesdk/${id}`);
    const previous = existsSync(file) ? readFileSync(file) : undefined;
    try {
      const child = spawnSync(process.execPath,
        ['scripts/compute-conformance.mjs', 'prepare', '--provider', id], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, COMPUTE_CONFORMANCE_EXPECTED_SOURCE: sourceFingerprint().sha256,
            COMPUTE_CONFORMANCE_MAX_CREATES: '1' },
        });
      assert.equal(child.status, code, `${id}: ${child.stderr}`);
      const report = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(report.nativePassed, 0);
      assert.equal(report.outcome, code === 0 ? 'prepared-not-executed' : 'blocked');
      if (reason) assert.equal(report.reason, reason);
    } finally {
      if (previous !== undefined) writeFileSync(file, previous);
      else rmSync(file, { force: true });
    }
  }
});
test('Namespace vault envdef selects only requested metadata, ignores deleted/other entries and preserves existing env', () => {
  const metadata = [
    { object_id: 'old', description: 'E2B_API_KEY', deleted_at: 'yesterday' },
    { object_id: 'selected-object', labels: [{ name: 'name', value: 'E2B_API_KEY' }] },
    { object_id: 'unselected-object', description: 'HOPX_API_KEY' },
  ];
  assert.equal(vaultEnvdef(metadata, e2b, {}), 'E2B_API_KEY=selected-object\n');
  assert.equal(vaultEnvdef(metadata, e2b, { E2B_API_KEY: 'already-set-unit-value' }), '');
});
test('missing optional vault entries do not invalidate already provided required config', () => {
  const sandbox0 = profiles.find(p => p.id === '@computesdk/sandbox0');
  assert.notEqual(credentialPattern(sandbox0, { SANDBOX0_TOKEN: 'unit-value' }), '');
  assert.equal(vaultEnvdef([], sandbox0, { SANDBOX0_TOKEN: 'unit-value' }), '');
});
for (const [label, metadata] of [
  ['duplicate active names', [{ object_id: 'a', description: 'E2B_API_KEY' }, { object_id: 'b', description: 'E2B_API_KEY' }]],
  ['malformed metadata', {}],
  ['missing selected keys', [{ object_id: 'other', description: 'HOPX_API_KEY' }]],
  ['newline object injection', [{ object_id: 'a\nOTHER_KEY=b', description: 'E2B_API_KEY' }]],
]) {
  test(`vault fails closed: ${label}`, () => assert.throws(() => vaultEnvdef(metadata, e2b, {})));
}
for (const [label, report, status] of [
  ['successful named native cases', successful, 0],
  ['hook failure despite passing assertions', successful, 1],
  ['zero native tests', { ...successful, nativePassed: 0 }, 0],
  ['only framework tests', { ...successful, mode: 'framework-mocked' }, 0],
  ['skipped native cases', { ...successful, nativeSkipped: 1 }, 0],
  ['failed file hook', { ...successful, failedFiles: 1 }, 0],
  ['unhandled native error', { ...successful, unhandledErrors: 1 }, 0],
  ['assertion failure', { ...successful, nativeFailed: 1 }, 0],
  ['killed process', successful, null],
]) {
  test(`native acceptance: ${label}`, () => {
    assert.equal(acceptedLiveResult(report, status), label === 'successful named native cases');
  });
}
test('sanitized reporter excludes framework cases, output and native error payloads', () => {
  const secret = 'unit-secret-must-not-be-written';
  const result = summarizeNative([{ type: 'suite', name: 'entrypoint', result: { state: 'fail', errors: [secret] }, tasks: [
    { type: 'suite', name: 'e2b [native]', tasks: [{ type: 'test', name: 'executes', result: { state: 'pass', errors: [secret] }, logs: [secret] }] },
    { type: 'suite', name: 'e2b [framework-mocked]', tasks: [{ type: 'test', name: 'self-test', result: { state: 'pass' } }] },
  ] }], [new Error(secret)]);
  assert.equal(result.nativePassed, 1);
  assert.equal(result.failedFiles, 1);
  assert.equal(result.unhandledErrors, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes('self-test'));
});
test('all selected contract titles must pass exactly once, not just one native smoke case', () => {
  const required = expectedCases(e2b);
  assert.equal(required.length, 15);
  const complete = { ...successful, nativePassed: required.length, cases: required.map(title => ({ title, state: 'pass' })) };
  assert.equal(acceptedLiveResult(complete, 0, required), true);
  assert.equal(acceptedLiveResult({ ...complete, cases: complete.cases.slice(1) }, 0, required), false);
  assert.equal(acceptedLiveResult({ ...complete, cases: [...complete.cases, complete.cases[0]] }, 0, required), false);
  assert.equal(expectedCases(e2b, 'crud').length, 5);
});
test('required case manifests track every existing suite title (including optional selections)', () => {
  const titles = file => [...readFileSync(new URL(file, import.meta.url), 'utf8')
    .matchAll(/\bit\('([^']+)'/g)].map(match => match[1]).sort();
  const full = { suite: { supportsFilesystem: true, supportsGetUrl: true, supportsBackground: true,
    supportsStreaming: true, supportsProcesses: true, ports: [3000, 8080] } };
  assert.deepEqual(expectedCases(full).sort(), titles('../../packages/test-utils/src/provider-test-suite.ts'));
  assert.deepEqual(expectedCases(e2b, 'crud').sort(), titles('../../packages/test-utils/src/provider-crud-test.ts'));
});
test('reviewed import exports resolve to built workspace artifacts without importing providers', () => {
  for (const profile of profiles.filter(p => p.readiness === 'wired')) {
    assert.ok(providerModule(profile).includes('/dist/'));
  }
});
test('source fingerprint is stable and includes new source/config files, not result artifacts', () => {
  const first = sourceFingerprint();
  assert.equal(first.sha256, sourceFingerprint().sha256);
  for (const name of ['conformance/compute-native.test.ts', 'conformance/compute-profiles.json',
    'packages/test-utils/src/provider-test-suite.ts', '.computesdk/workflows/provider-conformance.yml',
    'packages/e2b/tsup.config.ts', 'packages/e2b/tsconfig.json', 'tsconfig.json',
    'conformance/providers.json', 'scripts/load-compute-vault.sh', 'conformance/compute-cleanup-probe.ts',
    'conformance/vitest.unit.config.mts']) {
    assert.ok(first.inputs.some(input => input.file === name), name);
  }
  assert.ok(first.inputs.every(input => !input.file.startsWith('conformance-results/')));
  assert.ok(first.inputs.every(input => !input.file.includes('.bundled_')));
});
test('workflow is manual, serial, explicit about paid execution, and does not publish SDK packages', () => {
  const text = readFileSync(new URL('../../.computesdk/workflows/provider-conformance.yml', import.meta.url), 'utf8');
  for (const fragment of ['workflow_dispatch:', 'max-parallel: 1', 'expected_source:', 'max_create_attempts:',
    'compute-conformance.mjs prepare', 'compute-conformance.mjs run --execute', 'persist-credentials: false',
    'secrets.NSC_TOKEN', 'load-compute-vault.sh']) {
    assert.ok(text.includes(fragment), fragment);
  }
  assert.ok(!/\b(?:push|pull_request|schedule):|\b(?:pnpm|npm) (?:publish|release)\b/.test(text));
  assert.ok(!text.includes('secrets[matrix.'), 'Dynamic indexing grants the entire org secret context');
  assert.ok(text.indexOf('Build SDK candidate') < text.indexOf('Prepare Namespace vault authentication'),
    'Build code should not receive a bootstrapped Namespace vault token file');
});
test('execute=false emits a fully excluded nonempty vector, not 55 skipped but provisioned runner legs', () => {
  const child = spawnSync(process.execPath, ['scripts/compute-conformance.mjs', 'workflow-plan', '--provider', 'all'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, COMPUTE_CONFORMANCE_WORKFLOW_EXECUTE: 'false' } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { plan_only: ['not-executed'], exclude: [{ plan_only: 'not-executed' }] });
});
test('resource journal records only returned IDs and explicit SDK absence, never SDK objects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json'), sandbox = { sandboxId: 'unit-owned-id', secret: 'unit-must-not-be-persisted' };
    const journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    journal.requested(1);
    assert.equal(journal.returned(1, sandbox), sandbox);
    journal.absent(sandbox.sandboxId); journal.assertHealthy();
    const text = readFileSync(file, 'utf8'), report = JSON.parse(text);
    assert.equal(report.attempts[0].state, 'sdk-reported-absent');
    assert.equal(report.attempts[0].sandboxId, sandbox.sandboxId);
    assert.ok(!text.includes(sandbox.secret));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('cleanup diagnostics preserve the destroy ACK separately from later lookup outcomes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    journal.requested(1);
    journal.returned(1, { sandboxId: 'owned-unit-id', privateBody: 'NEVER-SERIALIZE-THIS' });
    journal.cleanupObserved('owned-unit-id', 'destroy-acknowledged');
    journal.cleanupObserved('owned-unit-id', 'lookup-pending');
    journal.cleanupObserved('owned-unit-id', 'sdk-present');
    let attempt = JSON.parse(readFileSync(file, 'utf8')).attempts[0];
    assert.equal(attempt.state, 'returned'); // ACK/presence is NOT absence.
    assert.equal(attempt.cleanup.phase, 'sdk-present');
    assert.ok(Number.isFinite(Date.parse(attempt.cleanup.destroyAcknowledgedAt)));
    journal.cleanupObserved('owned-unit-id', 'lookup-error');
    attempt = JSON.parse(readFileSync(file, 'utf8')).attempts[0];
    assert.equal(attempt.cleanup.phase, 'lookup-error');
    assert.ok(attempt.cleanup.destroyAcknowledgedAt);
    assert.ok(!readFileSync(file, 'utf8').includes('NEVER-SERIALIZE-THIS'));
    journal.absent('owned-unit-id'); journal.assertHealthy();
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).attempts[0].state, 'sdk-reported-absent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unknown cleanup targets or labels cannot fabricate evidence or leak arbitrary text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
    journal.cleanupObserved('unowned', 'destroy-acknowledged');
    journal.cleanupObserved('owned-unit-id', 'NEVER-SERIALIZE-THIS');
    assert.throws(() => journal.assertHealthy(), /journal is incomplete/);
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('NEVER-SERIALIZE-THIS'));
    assert.equal(JSON.parse(text).attempts[0].cleanup, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('reviewed native terminal evidence never fabricates SDK absence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, '@computesdk/createos-sandbox', '1'.repeat(64));
    journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
    journal.cleanupObserved('owned-unit-id', 'destroy-acknowledged');
    journal.nativeTerminal('owned-unit-id', 'createos-destroyed-metadata', 'destroyed');
    journal.assertHealthy();
    const attempt = JSON.parse(readFileSync(file, 'utf8')).attempts[0];
    assert.equal(attempt.state, 'native-reported-terminal');
    assert.equal(attempt.absenceAt, undefined);
    assert.deepEqual(attempt.terminalObservation, { oracle: 'createos-destroyed-metadata', status: 'destroyed' });
    assert.ok(attempt.cleanup.destroyAcknowledgedAt);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unreviewed terminal provider, oracle or state cannot produce cleanup evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    for (const [provider, oracle, status] of [
      [e2b.id, 'createos-destroyed-metadata', 'destroyed'],
      ['@computesdk/createos-sandbox', 'unreviewed', 'destroyed'],
      ['@computesdk/createos-sandbox', 'createos-destroyed-metadata', 'stopped'],
    ]) {
      const file = join(dir, 'resources.json');
      const journal = createResourceJournal(file, provider, '1'.repeat(64));
      journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
      journal.nativeTerminal('owned-unit-id', oracle, status);
      assert.throws(() => journal.assertHealthy(), /journal is incomplete/);
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).attempts[0].state, 'returned');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('post-allocation journal I/O failure cannot hide the exact original sandbox from cleanup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json'), sandbox = { sandboxId: 'unit-owned-id' };
    const journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    journal.requested(1);
    rmSync(file); mkdirSync(file);
    assert.equal(journal.returned(1, sandbox), sandbox);
    assert.throws(() => journal.assertHealthy(), /journal is incomplete/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('journal failure before a requested allocation rejects before forwarding any SDK create', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json'), journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    rmSync(file); mkdirSync(file);
    let forwarded = 0;
    assert.throws(() => { journal.requested(1); forwarded++; }, /could not be persisted/);
    assert.equal(forwarded, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const scenario of ['success', 'malformed-export', 'export-failed', 'optional-only']) {
  test(`vault shell integration uses only fake tooling: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'compute-vault-unit-'));
    try {
      const nsc = join(dir, 'nsc');
      writeFileSync(nsc, `#!${process.execPath}
import('node:fs').then(fs => {
  const a = process.argv.slice(2);
  if (a[0] === 'version') return;
  if (a[1] === 'list') return process.stdout.write(process.env.UNIT_VAULT_METADATA);
  if (a[1] === 'export') {
    const def = fs.readFileSync(a[a.indexOf('--envdef') + 1], 'utf8');
    if (def !== 'E2B_API_KEY=unit-object\\n') process.exit(8);
    if (process.env.UNIT_VAULT_SCENARIO === 'export-failed') {
      process.stderr.write('unit-sentinel-must-not-leak'); process.exit(9);
    }
    process.stdout.write(process.env.UNIT_VAULT_SCENARIO === 'malformed-export'
      ? 'export E2B_API_KEY="unit-sentinel-must-not-leak" ('
      : "export E2B_API_KEY='unit-selected-value'");
  }
});
`, { mode: 0o700 });
      const optional = scenario === 'optional-only';
      const child = spawnSync('bash', ['--noprofile', '--norc', '-c',
        'if . ./scripts/load-compute-vault.sh; then test -n "${E2B_API_KEY:-${SANDBOX0_TOKEN:-}}"; else exit 2; fi'], {
        encoding: 'utf8', env: {
          PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir,
          COMPUTE_CONFORMANCE_PROVIDER: optional ? '@computesdk/sandbox0' : e2b.id,
          ...(optional ? { SANDBOX0_TOKEN: 'unit-provided-value' } : {}),
          UNIT_VAULT_SCENARIO: scenario,
          UNIT_VAULT_METADATA: JSON.stringify(optional ? [] : [
            { description: 'E2B_API_KEY', object_id: 'unit-object' },
            { description: 'HOPX_API_KEY', object_id: 'unit-unselected-object' },
          ]),
        },
      });
      assert.equal(child.status, ['success', 'optional-only'].includes(scenario) ? 0 : 2, child.stderr);
      assert.ok(!`${child.stdout}${child.stderr}`.includes('unit-sentinel-must-not-leak'));
      assert.ok(!readdirSync(dir).some(name => name.startsWith('compute-conformance-vault.')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

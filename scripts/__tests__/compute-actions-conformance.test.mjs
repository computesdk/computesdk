import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProfiles, selectProfiles, blockedReason, credentialPattern, providerModule,
  sourceFingerprint, acceptedLiveResult, expectedCases, vaultEnvdef, createResourceJournal, reportPath, reviewedCleanup,
  profileCreateTimeoutMs } from '../compute-conformance.mjs';
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
test('only the explicit Sprites cold-create deadline differs; budgets do not select cases or retries', () => {
  const sprites = profiles.find(p => p.id === '@computesdk/sprites');
  assert.equal(profileCreateTimeoutMs(sprites), 90_000);
  assert.ok(profiles.filter(p => p !== sprites).every(p => profileCreateTimeoutMs(p) === 60_000));
  assert.deepEqual(expectedCases(sprites), expectedCases({ ...sprites, suite: { ...sprites.suite, createTimeoutMs: undefined } }));
  for (const value of [null, 0, -1, 0.5, '90000', true, Infinity, NaN, 120001, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => profileCreateTimeoutMs({ suite: { createTimeoutMs: value } }));
  }
  for (const value of [1, 60_000, 90_000, 120_000]) {
    assert.equal(profileCreateTimeoutMs({ suite: { createTimeoutMs: value } }), value);
  }
});
test('blocked profiles and missing configuration cannot become native pass', () => {
  assert.equal(blockedReason(profiles.find(p => p.id === '@computesdk/aws/agentcore'), {}), 'needs-reviewed-live-profile');
  assert.equal(blockedReason(e2b, {}), 'missing configuration: E2B_API_KEY');
  assert.equal(blockedReason(e2b, { E2B_API_KEY: 'unit-only-not-a-secret' }), null);
  const beam = profiles.find(p => p.id === '@computesdk/beam');
  assert.equal(blockedReason(beam, { BEAM_TOKEN: 'unit-value', BEAM_WORKSPACE_ID: 'unit-value' }), 'needs-reviewed-cleanup-contract');
  assert.deepEqual(profiles.filter(p => p.cleanup.status === 'source-reviewed-sdk-absence').map(p => p.id).sort(), [
    '@computesdk/e2b', '@computesdk/isorun', '@computesdk/leap0',
    '@computesdk/neevcloud', '@computesdk/sandbox0', '@computesdk/sprites', '@computesdk/vercel',
  ]);
  const createos = profiles.find(p => p.id === '@computesdk/createos-sandbox');
  assert.equal(createos.cleanup.status, 'source-reviewed-native-terminal');
  assert.equal(createos.cleanup.oracle, 'createos-destroyed-metadata');
  assert.equal(blockedReason(createos, { CREATEOS_SANDBOX_API_KEY: 'unit-value' }), null);
  assert.equal(blockedReason({ ...e2b, cleanup: createos.cleanup }, { E2B_API_KEY: 'unit-value' }),
    'needs-reviewed-cleanup-contract');
  const blaxel = profiles.find(p => p.id === '@computesdk/blaxel');
  assert.equal(reviewedCleanup(blaxel), true);
  assert.equal(blaxel.cleanup.oracle, 'blaxel-terminated-metadata');
  assert.deepEqual(profiles.filter(p => p.cleanup.status === 'source-reviewed-native-terminal').map(p => p.id).sort(),
    ['@computesdk/blaxel', '@computesdk/createos-sandbox', '@computesdk/modal', '@computesdk/upstash']);
  for (const [profile, cleanup] of [[blaxel, createos.cleanup], [createos, blaxel.cleanup]]) {
    assert.equal(reviewedCleanup({ ...profile, cleanup }), false);
  }
});
test('reviewed native terminal profiles remain provider-specific and require credentials', () => {
  const terminal = profiles.filter(p => p.cleanup.status === 'source-reviewed-native-terminal');
  for (const profile of terminal) {
    assert.equal(reviewedCleanup(profile), true);
    const env = Object.fromEntries(profile.requiredEnvironment.map(name => [name, 'unit-value']));
    assert.equal(blockedReason(profile, env), null);
    assert.match(blockedReason(profile, {}), /^missing configuration:/);
    for (const other of terminal.filter(p => p.id !== profile.id)) {
      assert.equal(reviewedCleanup({ ...profile, cleanup: other.cleanup }), false);
    }
  }
});
test('vault selection contains only missing names for the selected provider, never values', () => {
  assert.equal(credentialPattern(e2b, {}), '^(E2B_API_KEY)=$');
  const env = { E2B_API_KEY: 'unit-only-not-a-secret' };
  assert.equal(credentialPattern(e2b, env), '');
  assert.equal(env.E2B_API_KEY, 'unit-only-not-a-secret');
});
test('unreviewed cleanup attempt requires exact true and cannot bypass credentials, readiness or oracle review', () => {
  const beam = profiles.find(p => p.id === '@computesdk/beam');
  const credentials = Object.fromEntries(beam.requiredEnvironment.map(name => [name, 'unit-value']));
  for (const flag of [undefined, '', 'false', 'TRUE', '1', ' true ', true]) {
    assert.equal(blockedReason(beam, { ...credentials, COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP: flag }),
      'needs-reviewed-cleanup-contract');
  }
  const env = { ...credentials, COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP: 'true' };
  assert.equal(blockedReason(beam, env), null);
  assert.equal(reviewedCleanup(beam), false, 'attempt is not review or certification');
  assert.match(blockedReason(beam, { COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP: 'true' }), /^missing configuration:/);
  assert.equal(blockedReason({ ...beam, readiness: 'blocked' }, env), 'needs-reviewed-live-profile');
  for (const cleanup of [
    { ...beam.cleanup, oracle: 'unreviewed' },
    { ...beam.cleanup, status: 'unknown' },
    { ...beam.cleanup, status: 'source-reviewed-native-terminal', oracle: 'createos-destroyed-metadata' },
    { ...beam.cleanup, status: 'source-reviewed-sdk-absence', oracle: 'blaxel-terminated-metadata' },
  ]) assert.equal(blockedReason({ ...beam, cleanup }, env), 'needs-reviewed-cleanup-contract');
});
test('vault-check CLI is metadata-only and sanitizes missing names, invalid metadata and success', () => {
  const file = reportPath(e2b.id), previous = existsSync(file) ? readFileSync(file) : undefined;
  try {
    for (const [metadata, code, reason] of [
      [[], 2, 'missing configuration: E2B_API_KEY'],
      [[{ description: 'E2B_API_KEY', object_id: 'unit-private-object-id' }], 0, undefined],
      [[{ description: 'E2B_API_KEY', object_id: 'unit-private-object-id' },
        { description: 'E2B_API_KEY', object_id: 'unit-private-object-id-2' }], 2, 'invalid vault metadata'],
      [{ secret: 'unit-private-object-id' }, 2, 'invalid vault metadata'],
    ]) {
      const child = spawnSync(process.execPath, ['scripts/compute-conformance.mjs', 'vault-check', '--provider', 'e2b'], {
        input: JSON.stringify(metadata), encoding: 'utf8', env: { PATH: process.env.PATH,
          COMPUTE_CONFORMANCE_EXPECTED_SOURCE: sourceFingerprint().sha256, COMPUTE_CONFORMANCE_MAX_CREATES: '1' },
      });
      assert.equal(child.status, code, child.stderr);
      const text = readFileSync(file, 'utf8'), report = JSON.parse(text);
      assert.equal(report.nativePassed, 0);
      assert.equal(report.outcome, code ? 'blocked' : 'prepared-not-executed');
      if (reason) assert.equal(report.reason, reason);
      assert.ok(!`${text}${child.stdout}${child.stderr}`.includes('unit-private-object-id'));
    }
  } finally {
    if (previous !== undefined) writeFileSync(file, previous);
    else rmSync(file, { force: true });
  }
});
test('opt-in metadata stages still pin source, require a positive create cap, and preserve blocked outcomes', () => {
  const profile = profiles.find(p => p.id === '@computesdk/beam');
  const file = reportPath(profile.id), previous = existsSync(file) ? readFileSync(file) : undefined;
  const env = { PATH: process.env.PATH, COMPUTE_CONFORMANCE_PROVIDER: profile.id,
    COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP: 'true',
    COMPUTE_CONFORMANCE_EXPECTED_SOURCE: sourceFingerprint().sha256, COMPUTE_CONFORMANCE_MAX_CREATES: '15' };
  try {
    for (const [override, reason] of [
      [{ COMPUTE_CONFORMANCE_EXPECTED_SOURCE: '0'.repeat(64) }, 'candidate source fingerprint mismatch'],
      [{ COMPUTE_CONFORMANCE_MAX_CREATES: '0' }, 'explicit positive SDK create-attempt limit required'],
      [{ COMPUTE_CONFORMANCE_MAX_CREATES: '1.5' }, 'explicit positive SDK create-attempt limit required'],
      [{}, `missing configuration: ${profile.requiredEnvironment.join(', ')}`],
    ]) {
      const child = spawnSync(process.execPath, ['scripts/compute-conformance.mjs', 'vault-check'], {
        input: '[]', encoding: 'utf8', env: { ...env, ...override },
      });
      assert.equal(child.status, 2, child.stderr);
      const report = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(report.outcome, 'blocked');
      assert.equal(report.nativePassed, 0);
      assert.equal(report.reason, reason);
      const saved = readFileSync(file, 'utf8');
      const incomplete = spawnSync(process.execPath, ['scripts/compute-conformance.mjs', 'incomplete'], {
        encoding: 'utf8', env,
      });
      assert.equal(incomplete.status, 0, incomplete.stderr);
      assert.equal(readFileSync(file, 'utf8'), saved);
    }
  } finally {
    if (previous !== undefined) writeFileSync(file, previous);
    else rmSync(file, { force: true });
  }
});
test('actual prepare CLI reuses strict cleanup gates without requiring credentials', () => {
  for (const [id, code, reason, flag] of [
    ['e2b', 0, undefined],
    ['createos-sandbox', 0, undefined],
    ['blaxel', 0, undefined],
    ['beam', 2, 'needs-reviewed-cleanup-contract'],
    ['beam', 0, undefined, 'true'],
    ['beam', 2, 'needs-reviewed-cleanup-contract', 'TRUE'],
    ['aws/agentcore', 2, 'needs-reviewed-live-profile'],
    ['aws/agentcore', 2, 'needs-reviewed-live-profile', 'true'],
  ]) {
    const file = reportPath(`@computesdk/${id}`);
    const previous = existsSync(file) ? readFileSync(file) : undefined;
    try {
      const child = spawnSync(process.execPath,
        ['scripts/compute-conformance.mjs', 'prepare', '--provider', id], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, COMPUTE_CONFORMANCE_EXPECTED_SOURCE: sourceFingerprint().sha256,
            COMPUTE_CONFORMANCE_MAX_CREATES: '1',
            ...(flag === undefined ? {} : { COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP: flag }) },
        });
      assert.equal(child.status, code, `${id}: ${child.stderr}`);
      const report = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(report.nativePassed, 0);
      assert.equal(report.cleanupReview, profiles.find(p => p.id === `@computesdk/${id}`).cleanup.status);
      assert.equal(report.attemptUnreviewedCleanup, flag === 'true');
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
    'conformance/vitest.unit.config.mts', '.computesdk/workflows/compute-static.yml']) {
    assert.ok(first.inputs.some(input => input.file === name), name);
  }
  assert.ok(first.inputs.every(input => !input.file.startsWith('conformance-results/')));
  assert.ok(first.inputs.every(input => !input.file.includes('.bundled_')));
});
test('source fingerprint includes every immediate canonical Actions YAML workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-workflow-fingerprint-'));
  try {
    assert.equal(spawnSync('git', ['init', '--quiet', dir]).status, 0);
    mkdirSync(join(dir, '.computesdk/workflows/nested'), { recursive: true });
    writeFileSync(join(dir, '.computesdk/workflows/owned-probe.yaml'), 'name: fixture\n');
    writeFileSync(join(dir, '.computesdk/workflows/another-owned-probe.yml'), 'name: another\n');
    writeFileSync(join(dir, '.computesdk/workflows/nested/ignored.yml'), 'name: not-discovered\n');
    const first = sourceFingerprint(dir);
    assert.deepEqual(first.inputs.map(input => input.file), [
      '.computesdk/workflows/another-owned-probe.yml', '.computesdk/workflows/owned-probe.yaml',
    ]);
    writeFileSync(join(dir, '.computesdk/workflows/owned-probe.yaml'), 'name: changed\n');
    assert.notEqual(sourceFingerprint(dir).sha256, first.sha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('workflow is manual, bounded to five parallel legs, and checks metadata before install/build', () => {
  const text = readFileSync(new URL('../../.computesdk/workflows/provider-conformance.yml', import.meta.url), 'utf8');
  for (const fragment of ['workflow_dispatch:', 'max-parallel: 5', 'fail-fast: false', 'expected_source:', 'max_create_attempts:',
    'compute-conformance.mjs prepare', 'compute-conformance.mjs run --execute', 'persist-credentials: false',
    'secrets.NSC_TOKEN', 'load-compute-vault.sh', 'attempt_unreviewed_cleanup:',
    'COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP: ${{ inputs.attempt_unreviewed_cleanup }}',
    'nsc vault list --output json 2>/dev/null | node scripts/compute-conformance.mjs vault-check']) {
    assert.ok(text.includes(fragment), fragment);
  }
  assert.ok(!/\b(?:push|pull_request|schedule):|\b(?:pnpm|npm) (?:publish|release)\b/.test(text));
  assert.ok(!text.includes('secrets[matrix.'), 'Dynamic indexing grants the entire org secret context');
  assert.match(text, /attempt_unreviewed_cleanup:[\s\S]*?type: boolean\n        default: false/);
  assert.ok(text.indexOf('compute-conformance.mjs prepare') < text.indexOf('Prepare Namespace vault authentication'));
  assert.ok(text.indexOf('nscloud-setup@') < text.indexOf('compute-conformance.mjs vault-check'));
  assert.ok(text.indexOf('compute-conformance.mjs vault-check') < text.indexOf('pnpm install'));
  assert.ok(text.indexOf('pnpm install') < text.indexOf('Build SDK candidate'));
});
test('execute=false emits a fully excluded nonempty vector, not 55 skipped but provisioned runner legs', () => {
  const child = spawnSync(process.execPath, ['scripts/compute-conformance.mjs', 'workflow-plan', '--provider', 'all'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, COMPUTE_CONFORMANCE_WORKFLOW_EXECUTE: 'false' } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { plan_only: ['not-executed'], exclude: [{ plan_only: 'not-executed' }] });
});
test('all-compute static workflow pins source and Node22 without vault, credentials or native suites', () => {
  const text = readFileSync('.computesdk/workflows/compute-static.yml', 'utf8');
  assert.match(text, /expected_source:[\s\S]*required: true/);
  assert.match(text, /node-version: '22'/);
  assert.match(text, /process\.env\.EXPECTED_SOURCE !== actual/);
  assert.match(text, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.ok(text.indexOf('pnpm build') < text.indexOf('pnpm typecheck:compute'));
  assert.match(text, /pnpm check:provider-conformance/);
  assert.doesNotMatch(text, /secrets[.\[]|NSC_TOKEN|load-compute-vault|vitest|run --execute/);
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
test('public SDK progress is bounded fixed-label detail; old cleanup/terminal fields stay identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-progress-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, '@computesdk/createos-sandbox', '1'.repeat(64));
    const id = 'owned-unit-id';
    journal.requested(1); journal.returned(1, { sandboxId: id, body: 'RAW-BODY' });
    journal.cleanupObserved(id, 'destroy-acknowledged');
    journal.cleanupObserved(id, 'lookup-error');
    journal.nativeTerminal(id, 'createos-destroyed-metadata', 'destroyed');
    const read = () => JSON.parse(readFileSync(file, 'utf8')).attempts[0];
    const before = read();
    for (let n = 0; n < 100; n++) {
      journal.sdkProgress(id, 'presence', 'lookup-started');
      journal.sdkProgress(id, 'presence', 'lookup-wrong-identity');
      journal.sdkProgress(id, 'cleanup', 'lookup-started');
      journal.sdkProgress(id, 'cleanup', 'lookup-returned');
      journal.sdkProgress(id, 'cleanup', 'lookup-valid');
      journal.sdkProgress(id, 'cleanup', 'info-started');
      journal.sdkProgress(id, 'cleanup', 'info-deadline');
    }
    journal.assertHealthy();
    const { publicSdk, ...oldFields } = read();
    assert.deepEqual(oldFields, before);
    assert.equal(publicSdk.presence.phase, 'lookup-wrong-identity');
    assert.equal(publicSdk.cleanup.phase, 'info-deadline');
    assert.equal(Object.keys(publicSdk.presence.timestamps).length, 2);
    assert.equal(Object.keys(publicSdk.cleanup.timestamps).length, 5);
    for (const detail of Object.values(publicSdk)) {
      assert.ok(Number.isFinite(Date.parse(detail.observedAt)));
      for (const timestamp of Object.values(detail.timestamps)) assert.ok(Number.isFinite(Date.parse(timestamp)));
    }
    assert.ok(!readFileSync(file, 'utf8').includes('RAW-'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('public SDK progress rejects unknown labels/IDs without inspecting or serializing raw values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-progress-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
    let getterCalls = 0;
    const raw = {
      message: 'RAW-MESSAGE', cause: 'RAW-CAUSE', stack: 'RAW-STACK',
      code: 'RAW-CODE', httpStatus: 599, body: 'RAW-BODY', url: 'https://RAW-URL',
      wrongId: 'RAW-WRONG-ID', config: { credential: 'RAW-CREDENTIAL' },
      get private() { getterCalls++; throw new Error('RAW-GETTER'); },
      toJSON() { getterCalls++; throw new Error('RAW-TOJSON'); },
    };
    journal.sdkProgress('RAW-UNKNOWN-ID', 'presence', 'lookup-returned');
    journal.sdkProgress('owned-unit-id', 'RAW-VERIFICATION', 'lookup-returned');
    journal.sdkProgress('owned-unit-id', 'cleanup', 'RAW-PHASE');
    journal.sdkProgress('owned-unit-id', raw, raw);
    journal.sdkProgress('owned-unit-id', 'cleanup', raw);
    assert.throws(() => journal.assertHealthy(), /journal is incomplete/);
    assert.equal(getterCalls, 0);
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('RAW-'));
    assert.equal(JSON.parse(text).attempts[0].publicSdk, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('progress persistence failure does not hide owned resources or cleanup outcomes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-progress-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, e2b.id, '1'.repeat(64));
    const sandbox = { sandboxId: 'owned-unit-id' };
    journal.requested(1); journal.returned(1, sandbox);
    rmSync(file); mkdirSync(file);
    assert.doesNotThrow(() => journal.sdkProgress(sandbox.sandboxId, 'cleanup', 'lookup-null'));
    assert.doesNotThrow(() => journal.cleanupObserved(sandbox.sandboxId, 'sdk-absent'));
    assert.doesNotThrow(() => journal.absent(sandbox.sandboxId));
    assert.equal(journal.returned(1, sandbox), sandbox);
    assert.throws(() => journal.assertHealthy(), /journal is incomplete/);
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
test('destroy rejection records only fixed diagnostic fields and never establishes cleanup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, '@computesdk/codesandbox', '1'.repeat(64));
    journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
    journal.cleanupObserved('owned-unit-id', 'destroy-started');
    const error = Object.assign(new Error('PRIVATE-NATIVE-BODY'), {
      code: 'CODESANDBOX_LIFECYCLE_ERROR', provider: 'codesandbox',
      operation: 'delete', httpStatus: 404, cause: { token: 'PRIVATE-TOKEN' },
      request: { url: 'PRIVATE-URL' }, status: 'PRIVATE-STATUS',
    });
    journal.cleanupRejected('owned-unit-id', error);
    journal.assertHealthy();
    const text = readFileSync(file, 'utf8');
    const attempt = JSON.parse(text).attempts[0];
    assert.equal(attempt.state, 'returned');
    assert.equal(attempt.absenceAt, undefined);
    assert.equal(attempt.terminalAt, undefined);
    assert.equal(attempt.cleanup.phase, 'destroy-rejected');
    assert.equal(attempt.cleanup.destroyAcknowledgedAt, undefined);
    assert.ok(attempt.cleanup.destroyStartedAt);
    assert.ok(attempt.cleanup.destroyRejectedAt);
    assert.deepEqual(attempt.cleanup.failure, {
      code: 'CODESANDBOX_LIFECYCLE_ERROR', provider: 'codesandbox',
      operation: 'delete', httpStatus: 404,
    });
    assert.ok(!text.includes('PRIVATE-'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('cleanup diagnostics never invoke getters, infer status or retain a stale HTTP response', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    let getters = 0;
    const accessor = Object.defineProperty({}, 'code', { get() { getters++; throw new Error('PRIVATE'); } });
    const matching = { code: 'CODESANDBOX_LIFECYCLE_ERROR', provider: 'codesandbox', operation: 'delete' };
    for (const error of [
      new Error('PRIVATE'), accessor,
      new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE'); } }),
      { ...matching, provider: 'PRIVATE' },
      { ...matching, operation: 'PRIVATE' },
      ...[undefined, null, '404', NaN, 99, 600].map(httpStatus => ({ ...matching, httpStatus })),
    ]) {
      const file = join(dir, 'resources.json');
      const journal = createResourceJournal(file, '@computesdk/codesandbox', '1'.repeat(64));
      journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
      journal.cleanupRejected('owned-unit-id', { ...matching, httpStatus: 503 });
      journal.cleanupRejected('owned-unit-id', error);
      journal.assertHealthy();
      const text = readFileSync(file, 'utf8'), attempt = JSON.parse(text).attempts[0];
      assert.equal(attempt.cleanup.phase, 'destroy-rejected');
      assert.equal(attempt.cleanup.failure?.httpStatus, undefined);
      assert.equal(attempt.state, 'returned');
      assert.ok(!text.includes('PRIVATE'));
    }
    assert.equal(getters, 0);
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
test('Blaxel terminal journal accepts only exact TERMINATED metadata for an owned ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    const file = join(dir, 'resources.json');
    const journal = createResourceJournal(file, '@computesdk/blaxel', '1'.repeat(64));
    journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
    journal.nativeTerminal('owned-unit-id', 'blaxel-terminated-metadata', 'TERMINATED');
    journal.assertHealthy();
    const attempt = JSON.parse(readFileSync(file, 'utf8')).attempts[0];
    assert.equal(attempt.state, 'native-reported-terminal');
    assert.equal(attempt.absenceAt, undefined);
    assert.deepEqual(attempt.terminalObservation, { oracle: 'blaxel-terminated-metadata', status: 'TERMINATED' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unreviewed terminal provider, oracle or state cannot produce cleanup evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    for (const [provider, oracle, status] of [
      [e2b.id, 'createos-destroyed-metadata', 'destroyed'],
      ['@computesdk/createos-sandbox', 'unreviewed', 'destroyed'],
      ['@computesdk/createos-sandbox', 'createos-destroyed-metadata', 'stopped'],
      ['@computesdk/createos-sandbox', 'blaxel-terminated-metadata', 'TERMINATED'],
      ['@computesdk/blaxel', 'createos-destroyed-metadata', 'destroyed'],
      ['@computesdk/blaxel', 'blaxel-terminated-metadata', 'terminated'],
      ['@computesdk/blaxel', 'blaxel-terminated-metadata', 'stopped'],
      ['@computesdk/blaxel', 'unreviewed', 'TERMINATED'],
      ['@computesdk/upstash', 'upstash-deleted-metadata', 'paused'],
      ['@computesdk/upstash', 'upstash-deleted-metadata', 'error'],
      ['@computesdk/upstash', 'upstash-deleted-metadata', 'deleted '],
      ['@computesdk/upstash', 'modal-finished-exitcode', 0],
      ['@computesdk/modal', 'upstash-deleted-metadata', 'deleted'],
      ...[null, undefined, '0', false, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]
        .map(value => ['@computesdk/modal', 'modal-finished-exitcode', value]),
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
test('Modal numeric completion and Upstash deletion remain terminal observations, never absence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compute-journal-unit-'));
  try {
    for (const [provider, oracle, statuses] of [
      ['@computesdk/modal', 'modal-finished-exitcode', [0, 1, -9, 124, 137]],
      ['@computesdk/upstash', 'upstash-deleted-metadata', ['deleted']],
    ]) {
      for (const status of statuses) {
        const file = join(dir, 'resources.json');
        const journal = createResourceJournal(file, provider, '1'.repeat(64));
        journal.requested(1); journal.returned(1, { sandboxId: 'owned-unit-id' });
        journal.cleanupObserved('owned-unit-id', 'destroy-acknowledged');
        journal.nativeTerminal('owned-unit-id', oracle, status);
        journal.assertHealthy();
        const attempt = JSON.parse(readFileSync(file, 'utf8')).attempts[0];
        assert.equal(attempt.state, 'native-reported-terminal');
        assert.equal(attempt.absenceAt, undefined);
        assert.ok(attempt.cleanup.destroyAcknowledgedAt);
        assert.deepEqual(attempt.terminalObservation, { oracle, status });
      }
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

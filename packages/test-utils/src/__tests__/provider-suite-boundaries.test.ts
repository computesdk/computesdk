import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
function runFixture(scenario: string, strict = false, concurrent = false) {
  const directory = mkdtempSync(join(tmpdir(), 'computesdk-suite-boundaries-'));
  try {
    const report = join(directory, 'report.json');
    const observations = join(directory, 'observations.json');
    const child = spawnSync(process.execPath, [
      resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
      'packages/test-utils/src/__tests__/fixtures/provider-suite-boundaries.fixture.test.ts',
      '--maxWorkers=1', '--minWorkers=1', '--reporter=json', `--outputFile=${report}`,
      ...(concurrent ? ['--sequence.concurrent'] : []),
    ], {
      cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, COMPUTESDK_CONFORMANCE_NATIVE: strict ? '1' : '',
        PROVIDER_SUITE_BOUNDARIES_FIXTURE: '1', PROVIDER_SUITE_BOUNDARIES_SCENARIO: scenario,
        PROVIDER_SUITE_BOUNDARIES_OBSERVATIONS: observations },
    });
    if (child.error) throw child.error;
    const parsed = JSON.parse(readFileSync(report, 'utf8'));
    return { status: child.status, report: parsed,
      tests: parsed.testResults.flatMap((result: any) => result.assertionResults) as any[],
      calls: JSON.parse(readFileSync(observations, 'utf8')), output: child.stdout + child.stderr + JSON.stringify(parsed) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('existing provider suite registration boundaries (injected fakes, no native APIs)', () => {
  it('isolates each invocation and unrelated caller tests', () => {
    const result = runFixture('isolation');
    expect(result.status, result.output).toBe(0);
    expect(result.calls.create.filter((id: string) => id.startsWith('alpha-'))).toHaveLength(7);
    expect(result.calls.create.filter((id: string) => id.startsWith('beta-'))).toHaveLength(7);
    expect(result.calls.destroy).toEqual(result.calls.create);
    expect(result.calls.background).toEqual([]);
    expect(result.tests.filter((test) => test.fullName.includes('[native]'))).toHaveLength(14);
  }, 25_000);

  it('balances every allocation under caller global concurrency across two invocations and an unrelated test', () => {
    const result = runFixture('isolation-concurrent', false, true);
    const native = result.tests.filter((test) => test.fullName.includes('[native]'));
    expect(native).toHaveLength(14);
    expect(native.every((test) => test.status === 'passed'), result.output).toBe(true);
    expect(result.calls.create).toHaveLength(14);
    expect(result.calls.unrelated).toBe(1);
    expect([...result.calls.destroy].sort()).toEqual([...result.calls.create].sort());
    expect(new Set(result.calls.destroy).size).toBe(14);
    expect(result.status, result.output).toBe(0);
  }, 25_000);

  it('skips ordinary credential-disabled native coverage instead of passing canned assertions', () => {
    const result = runFixture('skip');
    expect(result.status, result.output).toBe(0);
    const native = result.tests.filter((test) => test.fullName.includes('[native]'));
    expect(native).toHaveLength(7);
    expect(native.every((test) => test.status === 'skipped')).toBe(true);
    expect(result.calls.create).toEqual([]);
  }, 25_000);

  it('labels explicit runUnitTests as framework self-tests without calling the adapter', () => {
    const result = runFixture('framework');
    expect(result.status, result.output).toBe(0);
    expect(result.tests.filter((test) => test.fullName.includes('[framework-mocked]'))).toHaveLength(7);
    expect(result.calls.create).toEqual([]);
  }, 25_000);

  it('forces native coverage in runIntegrationTests even if the input requested framework mode', () => {
    const result = runFixture('native-helper', true);
    expect(result.status, result.output).toBe(0);
    expect(result.calls.create).toHaveLength(7);
    expect(result.tests.filter((test) => test.fullName.includes('[native]'))).toHaveLength(7);
  }, 25_000);

  it('preserves background coverage by default, while explicit false excludes it', () => {
    const result = runFixture('background-default');
    expect(result.status, result.output).toBe(0);
    expect(result.calls.create).toHaveLength(8);
    expect(result.calls.background).toHaveLength(1);
    expect(result.tests.some((test) => test.title === 'should execute background commands')).toBe(true);
  }, 25_000);

  for (const scenario of ['strict-skip', 'strict-framework']) {
    it(`fails closed before create for ${scenario} under the native Actions gate`, () => {
      const result = runFixture(scenario, true);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('COMPUTESDK_CONFORMANCE_NATIVE');
      expect(result.calls.create).toEqual([]);
    }, 25_000);
  }

  it('fails on cleanup errors instead of silently passing or leaking native diagnostics', () => {
    const result = runFixture('cleanup-failure');
    expect(result.status).not.toBe(0);
    expect(result.report.numFailedTests).toBe(7);
    expect(result.output).toContain('Sandbox cleanup failed or timed out');
    expect(result.output).not.toContain('native-secret-do-not-print');
  }, 25_000);

  it('rejects a missing invalid-command exit code instead of treating undefined as nonzero', () => {
    const result = runFixture('undefined-exit');
    expect(result.status).not.toBe(0);
    expect(result.tests.filter((test) => test.status === 'failed').map((test) => test.title)).toEqual([
      'should handle invalid commands gracefully',
    ]);
  }, 25_000);

  it('resets ownership after a failed create rather than destroying the previous sandbox again', () => {
    const result = runFixture('create-rejection');
    expect(result.status).not.toBe(0);
    expect(result.calls.destroy).toEqual(result.calls.create.filter((_: string, index: number) => index !== 1));
    expect(result.tests.filter((test) => test.status === 'failed')).toHaveLength(1);
  }, 25_000);

  it('retains ownership and cleans up when positive SDK-presence verification rejects setup', () => {
    const result = runFixture('presence-failure');
    expect(result.status).not.toBe(0);
    expect(result.report.numFailedTests).toBe(7);
    expect(result.calls.verified).toEqual(result.calls.create);
    expect(result.calls.destroy).toEqual(result.calls.create);
    expect(result.calls.cleanupVerified).toEqual(result.calls.create);
    expect(result.calls.commands).toEqual([]);
    expect(result.calls.info).toEqual([]);
    expect(result.output).toContain('Sandbox verification failed or timed out');
    expect(result.output).not.toContain('native-secret-presence-verification');
  }, 25_000);

  it('runs optional presence and cleanup verification for every owned native sandbox', () => {
    const result = runFixture('verification-success');
    expect(result.status, result.output).toBe(0);
    expect(result.calls.verified).toEqual(result.calls.create);
    expect(result.calls.cleanupVerified).toEqual(result.calls.create);
    expect(result.calls.destroy).toEqual(result.calls.create);
    expect(result.calls.verified).toHaveLength(7);
  }, 25_000);

  it('does not pass native hooks on a destroy acknowledgement when cleanup verification rejects', () => {
    const result = runFixture('cleanup-verification-failure');
    expect(result.status).not.toBe(0);
    expect(result.report.numFailedTests).toBe(7);
    expect(result.calls.destroy).toEqual(result.calls.create);
    expect(result.calls.cleanupVerified).toEqual(result.calls.create);
    expect(result.output).toContain('Sandbox cleanup failed or timed out');
    expect(result.output).not.toContain('native-secret-cleanup-verification');
  }, 25_000);

  it('does not invoke native verification callbacks inherited by explicit framework self-tests', () => {
    const result = runFixture('framework-verification');
    expect(result.status, result.output).toBe(0);
    expect(result.calls.create).toEqual([]);
    expect(result.calls.verified).toEqual([]);
    expect(result.calls.cleanupVerified).toEqual([]);
  }, 25_000);

  it('accepts a 61,146ms fake allocation within an explicit 90s creation deadline and cleans once', () => {
    const result = runFixture('creation-timing-90k');
    expect(result.status, result.output).toBe(0);
    expect(result.calls.create).toHaveLength(7);
    expect(result.calls.destroy).toEqual(result.calls.create);
  }, 25_000);

  for (const scenario of ['creation-timing-default', 'creation-timing-body-only']) {
    it(`keeps the default 60s creation deadline separate from body timeout (${scenario})`, () => {
      const result = runFixture(scenario);
      expect(result.status).not.toBe(0);
      expect(result.report.numFailedTests).toBe(7);
      expect(result.calls.create).toHaveLength(7);
      expect(result.calls.destroy).toEqual(result.calls.create);
      expect(result.output).toContain('Sandbox creation failed or timed out');
    }, 25_000);
  }

  it('rejects invalid creation budgets before hook registration or any allocation', () => {
    for (const suffix of ['zero', 'negative', 'nan', 'string', 'infinite', 'fraction', 'unsafe', 'over-cap', 'framework']) {
      const result = runFixture(`creation-invalid-${suffix}`);
      expect(result.status).not.toBe(0);
      expect(result.calls.create).toEqual([]);
      expect(result.output).toContain('createTimeoutMs must be a positive safe integer');
    }
  }, 25_000);

});

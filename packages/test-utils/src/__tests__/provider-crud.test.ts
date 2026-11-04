import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const fixture = 'packages/test-utils/src/__tests__/fixtures/provider-crud.fixture.test.ts';

function runFixture(scenario: string) {
  const directory = mkdtempSync(join(tmpdir(), 'computesdk-crud-unit-'));
  try {
    const report = join(directory, 'report.json');
    const observations = join(directory, 'observations.json');

    const child = spawnSync(process.execPath, [
      resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', fixture,
      ...(scenario === 'concurrent-order' ? ['--sequence.concurrent'] : []),
      '--maxWorkers=1', '--minWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${report}`,
    ], {
      cwd: root,
      env: {
        ...process.env,
        CRUD_UNIT_FIXTURE: '1',
        CRUD_UNIT_SCENARIO: scenario,
        CRUD_UNIT_OBSERVATIONS: observations,
        COMPUTESDK_CONFORMANCE_NATIVE: scenario.startsWith('strict-') ? '1' : '0',
      },
      encoding: 'utf8',
      timeout: 40_000,
    });
    if (child.error) throw child.error;
    return {
      status: child.status,

      report: JSON.parse(readFileSync(report, 'utf8')),
      calls: JSON.parse(readFileSync(observations, 'utf8')),
      output: child.stdout + child.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('existing provider CRUD suite (injected fake provider, actual Vitest registration)', () => {
  it('preserves nested lifecycle order under global --sequence.concurrent', () => {
    const result = runFixture('concurrent-order');
    expect(result.status).toBe(0);
    expect(result.report.numFailedTests).toBe(0);
    expect(result.report.numPassedTests).toBe(6);
    expect(result.calls).toEqual({
      create: 1,
      destroy: ['owned-unit-sandbox'],
      get: 2,
      list: 1,
      afterDestroy: 1,
      order: ['create', 'get', 'list', 'destroy', 'verify'],
    });
  }, 45_000);

  it('fails a no-op destroy and retries only the owned sandbox during cleanup', () => {
    const result = runFixture('noop');
    expect(result.status).not.toBe(0);
    expect(result.report.numFailedTests).toBeGreaterThan(0);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox', 'owned-unit-sandbox']);
    expect(result.calls.list).toBe(1);
  }, 45_000);

  it('keeps verification below a shorter enclosing test timeout', () => {
    const result = runFixture('short-test-budget');
    expect(result.status).not.toBe(0);
    const verification = result.report.testResults[0].assertionResults.find(
      (test: { title: string }) => test.title === 'should report sandbox absence after destruction',
    );
    expect(verification.failureMessages.join(' ')).toContain('SDK-reported absence');
    expect(verification.failureMessages.join(' ')).not.toContain('Test timed out');
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox', 'owned-unit-sandbox']);
  }, 45_000);

  it('bounds a hanging verification query and does not forget cleanup after destroy acknowledgement', () => {
    const result = runFixture('hang');
    expect(result.status).not.toBe(0);
    const verification = result.report.testResults[0].assertionResults.find(
      (test: { title: string }) => test.title === 'should report sandbox absence after destruction',
    );
    expect(verification.duration).toBeLessThan(5_000);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox', 'owned-unit-sandbox']);
  }, 45_000);

  it('polls SDK-reported absence instead of blindly sleeping before destroy', () => {
    const result = runFixture('eventual');
    expect(result.status).toBe(0);
    const destruction = result.report.testResults[0].assertionResults.find(
      (test: { title: string }) => test.title === 'should destroy the sandbox',
    );
    expect(destruction.duration).toBeLessThan(5_000);
    expect(result.calls.afterDestroy).toBe(3);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox']);
  }, 45_000);

  it('surfaces cleanup failure without exposing the native error', () => {
    const result = runFixture('secret');
    expect(result.status).not.toBe(0);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox', 'owned-unit-sandbox']);
    expect(result.output + JSON.stringify(result.report)).not.toContain('NATIVE_SECRET');
  }, 45_000);

  it('captures an allocated ID before create assertions can fail', () => {
    const result = runFixture('create-assertion');
    expect(result.status).not.toBe(0);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox']);
    expect(JSON.stringify(result.report)).toContain('ORIGINAL_CREATE_ASSERTION');
  }, 45_000);

  it('fails its creation deadline and cleans the late returned ID without publishing it to later tests', () => {
    const result = runFixture('late-create');
    expect(result.status).not.toBe(0);
    const creation = result.report.testResults[0].assertionResults.find(
      (test: { title: string }) => test.title === 'should create a sandbox',
    );
    expect(creation.failureMessages.join(' ')).toContain('Create failed or exceeded its deadline');
    expect(result.calls.destroy).toEqual(['late-owned-unit-sandbox']);
    expect(result.calls.list).toBe(0);
    expect(result.calls.get).toBe(1);
  }, 45_000);

  it('honors a configured 120-second test budget for a 20-second allocation using a fake clock', () => {
    const result = runFixture('large-create-budget');
    expect(result.status).toBe(0);
    expect(result.calls.create).toBe(1);
    expect(result.calls.list).toBe(1);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox']);
    expect(result.calls.afterDestroy).toBe(1);
  }, 45_000);

  it('fails cleanup for an unresolved allocation instead of pretending no resource can exist', () => {
    const result = runFixture('never-create');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Allocation remained unresolved during cleanup');
    expect(result.calls).toEqual({ create: 1, destroy: [], get: 0, list: 0, afterDestroy: 0 });
  }, 45_000);

  it('keeps late allocation cleanup attached after the cleanup wait itself has expired', () => {
    const result = runFixture('late-after-cleanup');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Allocation remained unresolved during cleanup');
    expect(result.calls.destroy).toEqual(['late-owned-unit-sandbox']);
    expect(result.calls.list).toBe(0);
    expect(result.calls.get).toBe(1);
  }, 45_000);

  it('preserves the original failure when the independent cleanup hook also fails', () => {
    const result = runFixture('original-failure');
    expect(result.status).not.toBe(0);
    expect(result.calls.destroy).toEqual(['owned-unit-sandbox', 'owned-unit-sandbox']);
    expect(JSON.stringify(result.report)).toContain('ORIGINAL_LIST_FAILURE');
    expect(result.output).toContain('Failed to verify cleanup of an owned sandbox');
  }, 45_000);

  it.each(['skip', 'unsupported', 'disabled'])('preserves %s policy with zero provider calls', (scenario) => {
    const result = runFixture(scenario);
    expect(result.status).toBe(0);
    expect(result.calls).toEqual({ create: 0, destroy: [], get: 0, list: 0, afterDestroy: 0 });
  }, 45_000);

  it.each(['explicit-enable', 'strict-explicit-enable'])(
    'explicitly enables existing CRUD tests outside the allowlist (%s), using only a fake provider',
    (scenario) => {
      const result = runFixture(scenario);
      expect(result.status).toBe(0);
      expect(result.calls.create).toBe(1);
      expect(result.calls.list).toBe(1);
      expect(result.calls.destroy).toEqual(['owned-unit-sandbox']);
      expect(result.calls.afterDestroy).toBe(1);
    },
    45_000,
  );

  it.each(['strict-skip', 'strict-skip-enabled', 'strict-disabled', 'strict-unsupported'])(
    'strict native mode rejects %s during collection before any fake-provider call',
    (scenario) => {
      const result = runFixture(scenario);
      expect(result.status).not.toBe(0);
      expect(result.calls).toEqual({ create: 0, destroy: [], get: 0, list: 0, afterDestroy: 0 });
      expect(result.output).toContain('Native conformance cannot skip CRUD');
    },
    45_000,
  );
});

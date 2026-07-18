import { afterEach, describe, expect, it } from 'vitest';
import { bench, describe as benchDescribe, getRegisteredBenchmarks } from '../dsl';
import { resetBenchGlobal, setCurrentBenchFile } from '../globals';

const FIXTURE_FILE = '/tmp/bench-dsl.test';

afterEach(() => {
  resetBenchGlobal();
});

describe('dsl', () => {
  it('captures bench calls when a file context is active', () => {
    setCurrentBenchFile(FIXTURE_FILE);
    bench('a', () => 1);
    bench('b', () => 2);
    const registered = getRegisteredBenchmarks();
    expect(registered).toHaveLength(2);
    expect(registered[0]).toMatchObject({ name: 'a', groups: [], file: FIXTURE_FILE });
    expect(registered[1]).toMatchObject({ name: 'b' });
  });

  it('groups nested benchmarks with their parent names', () => {
    setCurrentBenchFile(FIXTURE_FILE);
    benchDescribe('outer', () => {
      benchDescribe('inner', () => {
        bench('work', () => null);
      });
      bench('top-level', () => null);
    });
    const registered = getRegisteredBenchmarks();
    expect(registered).toHaveLength(2);
    expect(registered[0]).toMatchObject({
      name: 'work',
      groups: ['outer', 'inner'],
      id: 'outer / inner / work',
    });
    expect(registered[1]).toMatchObject({
      name: 'top-level',
      groups: ['outer'],
      id: 'outer / top-level',
    });
  });

  it('resets the group stack after describe returns', () => {
    setCurrentBenchFile(FIXTURE_FILE);
    benchDescribe('a', () => {
      bench('inside', () => null);
    });
    bench('outside', () => null);
    const registered = getRegisteredBenchmarks();
    expect(registered[1]).toMatchObject({ groups: [] });
  });

  it('throws when bench() is called without an active file', () => {
    expect(() => bench('dangling', () => null)).toThrow(/outside of a benchmark file/);
  });
});

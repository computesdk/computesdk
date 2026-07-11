/**
 * Reference benchmark file showing the @computesdk/bench-cli DSL.
 * Run with `bench` (auto-discovers under ./benchmarks/) or
 * `bench run examples/benchmarks/sample.bench.ts`.
 */
import { bench, describe } from '@computesdk/bench-cli';

describe('string operations', () => {
  bench('concatenation', () => {
    'a' + 'b' + 'c' + 'd' + 'e';
  });

  bench('template literal', () => {
    `${'a'}${undefined}${null}${true}${1}`;
  });

  bench('Array#join', () => {
    ['a', 'b', 'c', 'd', 'e'].join('');
  });
});

describe('array operations', () => {
  const small = [3, 1, 4, 1, 5, 9, 2, 6];
  const big = Array.from({ length: 10_000 }, (_, i) => i);

  bench('Array#sort small', () => {
    small.slice().sort();
  });

  bench('Array#sort big', () => {
    big.slice().sort();
  });

  bench('Array#reduce small', () => {
    small.reduce((sum, value) => sum + value, 0);
  });

  bench('Array#reduce big', () => {
    big.reduce((sum, value) => sum + value, 0);
  });
});

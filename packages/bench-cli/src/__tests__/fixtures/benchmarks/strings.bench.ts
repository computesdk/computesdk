// Self-contained fixture: does not import from @computesdk/bench-cli so the
// integration test can run without requiring a workspace build.
import { bench, describe } from '../../../../src/dsl.js';

describe('strings', () => {
  bench('concat', () => {
    'a' + 'b' + 'c' + 'd';
  });

  bench('template', () => {
    `${'a'}${'b'}${'c'}${'d'}`;
  });
});

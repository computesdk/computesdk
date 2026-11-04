#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberate whitelist: real-adapter/native-boundary regressions and shared
// helper/core unit checks. Do not replace it with package scripts or globs;
// those can include credential-gated, paid integration tests.
const suites = [
  ['@computesdk/test-utils', 'provider-crud.test.ts', 'provider-lifecycle.test.ts', 'provider-suite-boundaries.test.ts', 'provider-suite-attempt.test.ts'],
  ['@computesdk/provider', 'command-output.test.ts', 'sizes.test.ts', 'legacy-size-types.test.ts'],
  ['computesdk', 'snapshot-metadata.test.ts', 'snapshot-affinity.test.ts', 'sizes.test.ts'],
  ['@computesdk/namespace', 'sizes.test.ts', 'snapshot.test.ts'],
  ['@computesdk/archil', 'sizes.test.ts'],
  ['@computesdk/e2b', 'snapshot-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/modal', 'command-output.test.ts', 'unit.test.ts', 'timeout-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/isorun', 'command-integrity.test.ts'],
  ['@computesdk/createos-sandbox', 'command-integrity.test.ts'],
  ['@computesdk/sandbox0', 'unit.test.ts'],
  ['@computesdk/microsandbox', 'index.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/sprites', 'command-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/daytona', 'command-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/vercel', 'command-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/hopx', 'command-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/beam', 'command-contract.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/blaxel', 'command-contract.test.ts', 'run-command.test.ts', 'lifecycle-contract.test.ts'],
  ['@computesdk/agentuity', 'lifecycle-contract.test.ts'],
  ['@computesdk/tensorlake', 'lifecycle-contract.test.ts', 'streaming.test.ts'],
  ['@computesdk/leap0', 'lifecycle-contract.test.ts'],
  ['@computesdk/lelantos', 'lifecycle-contract.test.ts', 'connection-opts.test.ts', 'run-command-env.test.ts'],
  ['@computesdk/upstash', 'lifecycle-contract.test.ts'],
  ['@computesdk/codesandbox', 'lifecycle-contract.test.ts'],
  ['@computesdk/givemeanode', 'lifecycle-contract.test.ts'],
];

const env = {
  ...process.env,
  SKIP_INTEGRATION: 'true',
  COMPUTESDK_INTEGRATION: '0',
  COMPUTESDK_CONFORMANCE_NATIVE: '0',
  COMPUTESDK_API_KEY: '',
  E2B_API_KEY: '',
  MODAL_TOKEN_ID: '',
  MODAL_TOKEN_SECRET: '',
  ISORUN_API_KEY: '',
  CREATEOS_SANDBOX_API_KEY: '',
  SANDBOX0_API_KEY: '',
  SANDBOX0_TOKEN: '',
  MICROSANDBOX_API_KEY: '',
  MSB_API_KEY: '',
  DAYTONA_API_KEY: '',
  SPRITES_API_KEY: '',
  SPRITES_TOKEN: '',
  VERCEL_TOKEN: '',
  VERCEL_OIDC_TOKEN: '',
  HOPX_API_KEY: '',
  BEAM_TOKEN: '',
  BEAM_WORKSPACE_ID: '',
  BL_API_KEY: '',
  BL_WORKSPACE: '',
  AGENTUITY_SDK_KEY: '',
  TENSORLAKE_API_KEY: '',
  LEAP0_API_KEY: '',
  LELANTOS_API_KEY: '',
  UPSTASH_BOX_API_KEY: '',
  CSB_API_KEY: '',
  GMN_TOKEN: '',
};
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform === 'win32') {
  console.error('These local shell-contract fixtures require a POSIX test host.');
  process.exitCode = 1;
} else {
  for (const [name, ...tests] of suites) {
    console.log(`\nProvider contract suite: ${name} (local mocks only)`);
    const result = spawnSync('pnpm', [
      '--filter', name, '--fail-if-no-match', 'exec', 'vitest', 'run',
      ...tests.map((test) => `src/__tests__/${test}`),
      '--maxWorkers=1', '--minWorkers=1',
    ], { cwd, env, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      console.error(`Provider contract suite failed: ${name}`);
      process.exitCode = 1;
      break;
    }
  }
}

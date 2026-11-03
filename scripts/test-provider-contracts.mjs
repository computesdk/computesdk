#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberate whitelist: these exercise real adapters with native boundaries
// mocked. Do not replace this with package test scripts or directory globs;
// those can include credential-gated, paid integration tests.
const suites = [
  ['@computesdk/provider', 'command-output.test.ts'],
  ['@computesdk/modal', 'command-output.test.ts', 'unit.test.ts'],
  ['@computesdk/isorun', 'command-integrity.test.ts'],
  ['@computesdk/createos-sandbox', 'command-integrity.test.ts'],
  ['@computesdk/sandbox0', 'unit.test.ts'],
  ['@computesdk/microsandbox', 'index.test.ts'],
  ['@computesdk/sprites', 'command-contract.test.ts'],
  ['@computesdk/daytona', 'command-contract.test.ts'],
];

const env = {
  ...process.env,
  SKIP_INTEGRATION: 'true',
  COMPUTESDK_API_KEY: '',
  MODAL_TOKEN_ID: '',
  MODAL_TOKEN_SECRET: '',
  ISORUN_API_KEY: '',
  CREATEOS_SANDBOX_API_KEY: '',
  SANDBOX0_API_KEY: '',
  SANDBOX0_TOKEN: '',
  MICROSANDBOX_API_KEY: '',
  DAYTONA_API_KEY: '',
  SPRITES_API_KEY: '',
  SPRITES_TOKEN: '',
};
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform === 'win32') {
  console.error('These local shell-contract fixtures require a POSIX test host.');
  process.exitCode = 1;
} else {
  for (const [name, ...tests] of suites) {
    console.log(`\nProvider contract suite: ${name} (native mocks only)`);
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

/**
 * Workbench helpers for use in TypeScript files
 * 
 * Import these in your .ts files for full TypeScript autocomplete!
 * 
 * @example
 * ```typescript
 * import { createWorkbenchSession } from '@computesdk/workbench/helpers';
 * 
 * const session = await createWorkbenchSession('e2b');
 * 
 * // Now you get full TypeScript autocomplete!
 * await session.npm.install('express');
 * await session.git.clone('https://github.com/user/repo');
 * ```
 */

import * as cmd from '@computesdk/cmd';
import { createCompute, type Provider } from 'computesdk';

export interface WorkbenchSession {
  sandbox: Awaited<ReturnType<ReturnType<typeof createCompute>['sandbox']['create']>>;
  // Re-export all cmd functions with the sandbox bound
  npm: typeof cmd.npm;
  pnpm: typeof cmd.pnpm;
  yarn: typeof cmd.yarn;
  bun: typeof cmd.bun;
  pip: typeof cmd.pip;
  git: typeof cmd.git;
  mkdir: typeof cmd.mkdir;
  ls: typeof cmd.ls;
  pwd: typeof cmd.pwd;
  cat: typeof cmd.cat;
  node: typeof cmd.node;
  python: typeof cmd.python;
  // ... add more as needed
}

/**
 * Create a workbench session for use in TypeScript files
 * This gives you full TypeScript autocomplete!
 */
export async function createWorkbenchSession(provider?: Provider): Promise<WorkbenchSession> {
  const compute = provider ? createCompute({ defaultProvider: provider }) : createCompute();
  const sandbox = await compute.sandbox.create();
  
  return {
    sandbox,
    npm: cmd.npm,
    pnpm: cmd.pnpm,
    yarn: cmd.yarn,
    bun: cmd.bun,
    pip: cmd.pip,
    git: cmd.git,
    mkdir: cmd.mkdir,
    ls: cmd.ls,
    pwd: cmd.pwd,
    cat: cmd.cat,
    node: cmd.node,
    python: cmd.python,
  };
}

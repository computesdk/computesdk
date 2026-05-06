/**
 * applySetup - Orchestrator that materializes a SetupConfig inside a sandbox.
 *
 * This runs *after* the provider has created a raw sandbox. It uses only the
 * universal Sandbox interface (runCommand, filesystem) so it works on every
 * provider without provider-specific code. Providers that want to handle setup
 * natively (e.g. by baking it into a template image) can intercept earlier.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Sandbox, RunCommandOptions } from './types/universal-sandbox';
import type { Dep, SetupConfig, SetupSource } from './setup';

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runOrThrow(
  sandbox: Sandbox,
  command: string,
  options: RunCommandOptions | undefined,
  context: string,
): Promise<void> {
  const result = await sandbox.runCommand(command, options);
  if (result.exitCode !== 0) {
    const stderr = result.stderr?.trim() || result.stdout?.trim() || '(no output)';
    throw new Error(
      `Setup step failed (${context}, exit ${result.exitCode}):\n  $ ${command}\n${stderr}`,
    );
  }
}

async function materializeSource(
  sandbox: Sandbox,
  source: SetupSource,
  env: Record<string, string> | undefined,
): Promise<void> {
  switch (source.type) {
    case 'github': {
      const url = `https://github.com/${source.repo}.git`;
      if (source.ref) {
        // `git clone --branch` only resolves branches and tags, so it rejects
        // commit SHAs — the standard way to pin a reproducible checkout.
        // `git fetch <ref>` accepts branches, tags, and SHAs uniformly on GitHub
        // (uploadpack.allowReachableSHA1InWant is enabled there by default).
        const command =
          `git init -q && ` +
          `git remote add origin ${shellEscape(url)} && ` +
          `git fetch --depth 1 origin ${shellEscape(source.ref)} && ` +
          `git checkout -q FETCH_HEAD`;
        await runOrThrow(
          sandbox,
          command,
          env ? { env } : undefined,
          `clone ${source.repo}@${source.ref}`,
        );
      } else {
        const command = `git clone --depth 1 ${shellEscape(url)} .`;
        await runOrThrow(sandbox, command, env ? { env } : undefined, `clone ${source.repo}`);
      }
      return;
    }
    case 'tar': {
      const command = `curl -fsSL ${shellEscape(source.url)} | tar -xz -C .`;
      await runOrThrow(sandbox, command, env ? { env } : undefined, `extract tar ${source.url}`);
      return;
    }
    case 'local': {
      await uploadDirectory(sandbox, source.path, '.');
      return;
    }
  }
}

async function uploadDirectory(
  sandbox: Sandbox,
  hostPath: string,
  sandboxPath: string,
): Promise<void> {
  const stat = await fs.stat(hostPath);
  if (!stat.isDirectory()) {
    throw new Error(`Local source path is not a directory: ${hostPath}`);
  }
  const entries = await fs.readdir(hostPath, { withFileTypes: true });
  for (const entry of entries) {
    const childHost = path.join(hostPath, entry.name);
    const childSandbox = sandboxPath === '.' ? entry.name : `${sandboxPath}/${entry.name}`;
    if (entry.isDirectory()) {
      await sandbox.filesystem.mkdir(childSandbox);
      await uploadDirectory(sandbox, childHost, childSandbox);
    } else if (entry.isFile()) {
      // Phase 1: text files only. The universal SandboxFileSystem.writeFile
      // signature is (path, content: string) — binary uploads need a future
      // extension to the interface.
      const content = await fs.readFile(childHost, 'utf-8');
      await sandbox.filesystem.writeFile(childSandbox, content);
    }
  }
}

async function installDeps(
  sandbox: Sandbox,
  deps: readonly Dep[],
  env: Record<string, string> | undefined,
): Promise<void> {
  for (const dep of deps) {
    const command = `nix profile install ${shellEscape(`nixpkgs#${dep.nixPkg}`)}`;
    await runOrThrow(sandbox, command, env ? { env } : undefined, `install dep ${dep.name}`);
  }
}

async function runInstall(
  sandbox: Sandbox,
  install: string | readonly string[],
  env: Record<string, string> | undefined,
): Promise<void> {
  const commands = typeof install === 'string' ? [install] : install;
  for (const command of commands) {
    await runOrThrow(sandbox, command, env ? { env } : undefined, 'install script');
  }
}

/**
 * Materialize a SetupConfig inside an already-created sandbox: pull source,
 * install deps via Nix, run install scripts. Throws on the first failure;
 * caller is responsible for destroying the sandbox if it wants to clean up.
 *
 * `options.env` overrides `setup.env` for the duration of setup commands. The
 * caller (compute core) is responsible for resolving precedence between
 * user-supplied envs and `setup.env` and passing the merged result here.
 */
export async function applySetup(
  sandbox: Sandbox,
  setup: SetupConfig,
  options?: { env?: Record<string, string> },
): Promise<void> {
  const env =
    options?.env ?? (setup.env as Record<string, string> | undefined);
  if (setup.source) {
    await materializeSource(sandbox, setup.source, env);
  }
  if (setup.deps && setup.deps.length > 0) {
    await installDeps(sandbox, setup.deps, env);
  }
  if (setup.install) {
    await runInstall(sandbox, setup.install, env);
  }
}

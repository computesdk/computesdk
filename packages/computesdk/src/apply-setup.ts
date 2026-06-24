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
    if (entry.isSymbolicLink()) {
      // Phase 1 has no symlink primitive on the universal filesystem, and
      // dereferencing on the host risks cycles and path-escape. Fail loud
      // instead of silently dropping the entry from the upload.
      throw new Error(
        `Cannot upload symlink from local source: ${childHost}. ` +
          `defineSetup({ source: { type: 'local' } }) currently does not support symbolic links. ` +
          `Use a github or tar source for projects that rely on symlinks.`,
      );
    } else if (entry.isDirectory()) {
      await sandbox.filesystem.mkdir(childSandbox);
      await uploadDirectory(sandbox, childHost, childSandbox);
    } else if (entry.isFile()) {
      // Phase 1: text files only. The universal SandboxFileSystem.writeFile
      // signature is (path, content: string) — binary uploads need a future
      // extension to the interface. Read raw bytes and reject anything that
      // isn't UTF-8 text so a binary asset can't silently corrupt on upload.
      const buffer = await fs.readFile(childHost);
      if (buffer.includes(0)) {
        throw new Error(
          `Cannot upload binary file from local source: ${childHost}. ` +
            `defineSetup({ source: { type: 'local' } }) currently supports UTF-8 text files only. ` +
            `Use a github or tar source for projects with binary assets.`,
        );
      }
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new Error(
          `Cannot upload non-UTF-8 file from local source: ${childHost}. ` +
            `defineSetup({ source: { type: 'local' } }) currently supports UTF-8 text files only. ` +
            `Use a github or tar source for projects with binary assets.`,
        );
      }
      await sandbox.filesystem.writeFile(childSandbox, content);
    }
  }
}

async function installDeps(
  sandbox: Sandbox,
  deps: readonly Dep[],
  env: Record<string, string> | undefined,
): Promise<void> {
  if (deps.length === 0) return;
  // Batch into a single `nix profile install` so we pay the eval cost once and
  // let Nix parallelize fetches/builds across the whole list, instead of
  // serializing N separate invocations.
  const args = deps.map((dep) => shellEscape(`nixpkgs#${dep.nixPkg}`)).join(' ');
  const command = `nix profile install ${args}`;
  const context = `install deps [${deps.map((dep) => dep.name).join(', ')}]`;
  await runOrThrow(sandbox, command, env ? { env } : undefined, context);
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

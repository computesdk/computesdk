/**
 * @computesdk/cli
 *
 * ComputeSDK CLI - Cloud-native workspace management.
 *
 * Usage:
 *   compute                              # interactive workspace creation
 *   compute owner/repo                   # create workspace for repo
 *   compute --repo owner/repo --branch fix-auth
 *   compute workspace                    # manage existing workspaces
 *   compute exec <id> <cmd...>           # run command in sandbox
 *   compute connect <id>                 # interactive shell
 *   compute destroy <id...>              # destroy sandboxes
 *   compute run -- <cmd...>              # create + exec + optional destroy
 *   compute providers                    # list configured providers
 */

import 'dotenv/config';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { compute, type SandboxInterface } from 'computesdk';
import { getProviderStatus } from './providers.js';
import { startPTY } from './pty.js';
import { clearStoredCredentials } from './auth.js';
import { ensureAuth, resolveProvider, configureCompute } from './setup.js';
import {
  workspaceCreate,
  workspaceAttach,
  workspaceList,
  workspaceDestroy,
  sandboxList,
  loadWorkspaceState,
  type Workspace,
} from './workspace-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

// Detect if running from dev workspace
const isDevBuild = import.meta.url.includes('worktrees') || 
                   import.meta.url.includes('/packages/cli/');
const VERSION = isDevBuild ? `${packageJson.version}-dev` : packageJson.version;

const program = new Command();

program
  .name('compute')
  .description('Cloud-native workspace management')
  .version(VERSION)
  .enablePositionalOptions()
  .passThroughOptions();

// ─── Default action: Show help ─────────────────────────────────────────────

program
  .option('--login', 'force re-authentication')
  .option('--logout', 'clear stored credentials')
  .action(async (opts) => {
    if (opts.logout) {
      console.log();
      p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
      clearStoredCredentials();
      p.log.success('Logged out. Stored credentials removed.');
      p.outro(pc.green('Done!'));
      process.exit(0);
    }

    if (opts.login) {
      console.log();
      p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
      await ensureAuth({ forceLogin: true });
      p.outro(pc.green('Authenticated!'));
      process.exit(0);
    }

    // Show help by default
    program.help();
  });

// ─── Create Command (like create-compute) ─────────────────────────────────

program
  .command('create')
  .description('Create a new workspace (same as create-compute)')
  .argument('[repo]', 'Repository in owner/repo format')
  .option('-b, --branch <branch>', 'Branch name', 'main')
  .option('-p, --provider <provider>', 'provider to use')
  .option('--no-attach', 'Create workspace but do not attach')
  .action(async (repo, options) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    await ensureAuth();

    if (!repo) {
      const state = loadWorkspaceState();
      const workspaceIds = Object.keys(state.workspaces);

      if (workspaceIds.length > 0) {
        // Show existing workspaces to attach to
        const choices = workspaceIds.map((id) => {
          const ws = state.workspaces[id];
          const age = Math.round(
            (Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24),
          );
          const ageStr = age === 0 ? 'today' : `${age}d ago`;
          return {
            value: id,
            label: `${id} (${ws.provider}, ${ageStr})`,
          };
        });

        const selected = await p.select({
          message: 'Select workspace to attach (or create new)',
          options: [
            ...choices,
            { value: '__new__', label: pc.gray('+ Create new workspace') },
          ],
        });

        if (p.isCancel(selected)) {
          p.cancel('Cancelled');
          process.exit(0);
        }

        if (selected !== '__new__') {
          await workspaceAttach(selected as string);
          return;
        }

        // Fall through to create new
      }

      // Prompt for repo
      const repoInput = await p.text({
        message: 'Repository to work on?',
        placeholder: 'owner/repo',
        validate: (value) => {
          if (!value || !value.includes('/')) {
            return 'Please enter a repository in owner/repo format';
          }
        },
      });

      if (p.isCancel(repoInput)) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      repo = repoInput as string;
    }

    // Validate repo format
    if (!repo.includes('/')) {
      p.log.error('Invalid repository format. Use: owner/repo');
      process.exit(1);
    }

    const provider = await resolveProvider(options.provider, { interactive: true });
    configureCompute(provider);

    const spinner = p.spinner();
    spinner.start('Creating workspace...');

    try {
      const workspace = await workspaceCreate({
        repo,
        branch: options.branch,
        provider,
      });

      spinner.stop(`Workspace ready: ${pc.cyan(workspace.id)}`);

      if (options.attach !== false) {
        console.log();
        await workspaceAttach(workspace.id);
      } else {
        p.outro(pc.green('Workspace created!'));
      }
    } catch (error) {
      spinner.stop(pc.red('Failed to create workspace'));
      p.log.error((error as Error).message);
      process.exit(1);
    }
  });

// ─── Sandbox Commands ───────────────────────────────────────────────────────

const sandboxCmd = program
  .command('sandbox')
  .alias('sb')
  .description('Manage raw sandboxes (VMs without git/worktree)');

sandboxCmd
  .command('create')
  .description('Create a new sandbox')
  .option('-p, --provider <provider>', 'provider to use')
  .option('--timeout <duration>', 'sandbox timeout (e.g. 5m, 1h)')
  .option('--name <name>', 'sandbox name')
  .option('--connect', 'start interactive shell after creation')
  .option('--silent', 'only output the sandbox ID')
  .action(async (opts) => {
    if (!opts.silent) {
      console.log();
      p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    }

    await ensureAuth();
    const provider = await resolveProvider(opts.provider);
    configureCompute(provider);

    if (!opts.silent) {
      const spinner = p.spinner();
      spinner.start('Creating sandbox...');
      try {
        const sandbox = await compute.sandbox.create(
          buildCreateOptions(opts),
        );
        spinner.stop(`Sandbox ready: ${pc.cyan(sandbox.sandboxId)}`);

        // Track the sandbox in local state
        const { saveSandbox } = await import('./workspace-cli.js');
        await saveSandbox({
          id: sandbox.sandboxId,
          sandboxId: sandbox.sandboxId,
          provider: provider,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
        });

        if (opts.connect) {
          console.log(pc.gray('  Entering shell... (.exit or Ctrl+D to return)'));
          console.log();
          // Clear screen for clean PTY session
          process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
          await startPTY(sandbox);
        }
      } catch (error) {
        spinner.stop(pc.red('Failed to create sandbox'));
        p.log.error((error as Error).message);
        process.exit(1);
      }
    } else {
      try {
        const sandbox = await compute.sandbox.create(
          buildCreateOptions(opts),
        );
        // Silent mode: only print sandbox ID for scripting
        process.stdout.write(sandbox.sandboxId);

        // Track the sandbox in local state (even in silent mode)
        const { saveSandbox } = await import('./workspace-cli.js');
        await saveSandbox({
          id: sandbox.sandboxId,
          sandboxId: sandbox.sandboxId,
          provider: provider,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
        });

        if (opts.connect) {
          console.log();
          // Clear screen for clean PTY session
          process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
          await startPTY(sandbox);
        }
      } catch (error) {
        process.stderr.write((error as Error).message + '\n');
        process.exit(1);
      }
    }
  });

sandboxCmd
  .command('destroy')
  .description('Destroy one or more sandboxes')
  .aliases(['rm', 'stop'])
  .argument('[sandbox_id...]', 'sandbox IDs to destroy (optional - will show picker if not provided)')
  .option('-p, --provider <provider>', 'provider to use')
  .action(async (sandboxIds: string[] | undefined, opts) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    
    // Load state
    const { loadState, saveState } = await import('./workspace-cli.js');
    const state = loadState();
    
    // If no IDs provided, show interactive picker
    if (!sandboxIds || sandboxIds.length === 0) {
      const workspaces = Object.values(state.workspaces);

      if (workspaces.length === 0) {
        p.log.info('No sandboxes to destroy.');
        p.outro(pc.green('Done!'));
        return;
      }

      const choices = workspaces.map((ws) => {
        const age = Math.round(
          (Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24),
        );
        const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
        const status = age > 7 ? pc.red('stale') : age > 1 ? pc.yellow('idle') : pc.green('active');
        return {
          value: ws.sandboxId,
          label: `${status} ${ws.sandboxId} (${ws.provider}, last active ${ageStr})`,
        };
      });

      // Allow multi-select with space, or single select with enter
      const selected = await p.multiselect({
        message: 'Select sandboxes to destroy (space to select, enter to confirm)',
        options: choices,
      });

      if (p.isCancel(selected) || (selected as string[]).length === 0) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      sandboxIds = selected as string[];
    }
    
    await ensureAuth();
    const provider = await resolveProvider(opts.provider);
    configureCompute(provider);

    const results = await Promise.allSettled(
      sandboxIds.map(async (id) => {
        await compute.sandbox.destroy(id);
        return id;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const sandboxId = result.value;
        console.log(pc.green(`Destroyed ${sandboxId}`));
        
        // Remove from state if tracked
        const workspaceId = Object.keys(state.workspaces).find(
          key => state.workspaces[key].sandboxId === sandboxId
        );
        if (workspaceId) {
          delete state.workspaces[workspaceId];
        }
      } else {
        console.error(pc.red(`Failed to destroy: ${result.reason?.message || result.reason}`));
      }
    }
    
    // Save updated state
    saveState(state);
  });

sandboxCmd
  .command('list')
  .alias('ls')
  .description('List all sandboxes')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    await sandboxList();
  });

sandboxCmd
  .command('connect')
  .description('Connect to a sandbox via PTY (same as compute connect)')
  .aliases(['ssh', 'shell'])
  .argument('[sandbox_id]', 'sandbox ID (optional - will show picker if not provided)')
  .option('-p, --provider <provider>', 'provider to use')
  .action(async (sandboxId: string | undefined, opts) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    await ensureAuth();
    const provider = await resolveProvider(opts.provider);
    configureCompute(provider);

    // If no sandbox_id provided, show interactive picker
    if (!sandboxId) {
      const { loadState } = await import('./workspace-cli.js');
      const state = loadState();
      const workspaces = Object.values(state.workspaces);

      if (workspaces.length === 0) {
        p.log.info('No sandboxes found.');
        p.log.info('Create one with: compute sandbox create');
        p.outro(pc.green('Done!'));
        return;
      }

      const choices = workspaces.map((ws) => {
        const age = Math.round(
          (Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24),
        );
        const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
        const status = age > 7 ? pc.red('stale') : age > 1 ? pc.yellow('idle') : pc.green('active');
        return {
          value: ws.sandboxId,
          label: `${status} ${ws.sandboxId} (${ws.provider}, last active ${ageStr})`,
        };
      });

      const selected = await p.select({
        message: 'Select sandbox to connect',
        options: choices,
      });

      if (p.isCancel(selected)) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      sandboxId = selected as string;
    }

    const spinner = p.spinner();
    spinner.start('Connecting...');
    const sandbox = await compute.sandbox.getById(sandboxId);
    if (!sandbox) {
      spinner.stop(pc.red(`Sandbox not found: ${sandboxId}`));
      process.exit(1);
    }

    spinner.stop('');
    
    // Clear screen for clean PTY session (like SSH)
    process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
    
    await startPTY(sandbox);
  });

sandboxCmd
  .command('exec')
  .description('Execute a command in a sandbox')
  .argument('<sandbox_id>', 'sandbox ID')
  .argument('<command...>', 'command to run')
  .option('-p, --provider <provider>', 'provider to use')
  .option('-e, --env <key=value...>', 'environment variables')
  .option('-w, --workdir <directory>', 'working directory')
  .passThroughOptions()
  .action(async (sandboxId: string, command: string[], opts) => {
    await ensureAuth();
    const provider = await resolveProvider(opts.provider);
    configureCompute(provider);

    const sandbox = await compute.sandbox.getById(sandboxId);
    if (!sandbox) {
      console.error(pc.red(`Sandbox not found: ${sandboxId}`));
      process.exit(1);
    }

    const cmd = buildExecCommand(command, opts);
    const result = await sandbox.runCommand(cmd);

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.exitCode);
  });

// ─── Connect Command (top-level alias) ───────────────────────────────────────

program
  .command('connect')
  .description('Connect to a sandbox via PTY')
  .aliases(['ssh', 'shell'])  // Keep aliases but document connect as primary
  .argument('[sandbox_id]', 'sandbox ID (optional - will show picker if not provided)')
  .option('-p, --provider <provider>', 'provider to use')
  .action(async (sandboxId: string | undefined, opts) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    await ensureAuth();
    const provider = await resolveProvider(opts.provider);
    configureCompute(provider);

    // If no sandbox_id provided, show interactive picker
    if (!sandboxId) {
      const { loadState } = await import('./workspace-cli.js');
      const state = loadState();
      const workspaces = Object.values(state.workspaces);

      if (workspaces.length === 0) {
        p.log.info('No sandboxes found.');
        p.log.info('Create one with: compute sandbox create');
        p.outro(pc.green('Done!'));
        return;
      }

      const choices = workspaces.map((ws) => {
        const age = Math.round(
          (Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24),
        );
        const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
        const status = age > 7 ? pc.red('stale') : age > 1 ? pc.yellow('idle') : pc.green('active');
        return {
          value: ws.sandboxId,
          label: `${status} ${ws.sandboxId} (${ws.provider}, last active ${ageStr})`,
        };
      });

      const selected = await p.select({
        message: 'Select sandbox to connect',
        options: choices,
      });

      if (p.isCancel(selected)) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      sandboxId = selected as string;
    }

    const spinner = p.spinner();
    spinner.start('Connecting...');
    const sandbox = await compute.sandbox.getById(sandboxId);
    if (!sandbox) {
      spinner.stop(pc.red(`Sandbox not found: ${sandboxId}`));
      process.exit(1);
    }

    spinner.stop('');
    
    // Clear screen for clean PTY session (like SSH)
    process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
    
    await startPTY(sandbox);
  });

// ─── Workspace Commands ─────────────────────────────────────────────────────

const workspaceCmd = program
  .command('workspace')
  .alias('ws')
  .description('Manage workspaces (sandbox + git + worktree)');

workspaceCmd
  .command('create')
  .description('Create a new workspace')
  .argument('[repo]', 'Repository in owner/repo format')
  .option('-b, --branch <branch>', 'Branch name', 'main')
  .option('-p, --provider <provider>', 'provider to use')
  .option('--no-attach', 'Create workspace but do not attach')
  .action(async (repo, options) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    await ensureAuth();

    if (!repo) {
      p.log.info('Usage: compute workspace create owner/repo --branch main');
      p.outro(pc.green('Done!'));
      return;
    }

    const provider = await resolveProvider(options.provider, { interactive: true });
    configureCompute(provider);

    const spinner = p.spinner();
    spinner.start('Creating workspace...');

    try {
      const workspace = await workspaceCreate({
        repo,
        branch: options.branch,
        provider,
      });

      spinner.stop(`Workspace ready: ${pc.cyan(workspace.id)}`);

      if (options.attach !== false) {
        console.log();
        await workspaceAttach(workspace.id);
      } else {
        p.outro(pc.green('Workspace created!'));
      }
    } catch (error) {
      spinner.stop(pc.red('Failed to create workspace'));
      p.log.error((error as Error).message);
      process.exit(1);
    }
  });

workspaceCmd
  .command('list')
  .alias('ls')
  .description('List all workspaces')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    await workspaceList();
  });

workspaceCmd
  .command('destroy')
  .alias('rm')
  .description('Destroy a workspace')
  .argument('[id]', 'Workspace ID (repo:branch format, optional - will show picker if not provided)')
  .action(async (id: string | undefined) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    // If no ID provided, show interactive picker
    if (!id) {
      const state = loadWorkspaceState();
      const workspaceIds = Object.keys(state.workspaces);

      if (workspaceIds.length === 0) {
        p.log.info('No workspaces to destroy.');
        p.outro(pc.green('Done!'));
        return;
      }

      const choices = workspaceIds.map((key) => {
        const ws = state.workspaces[key];
        const age = Math.round(
          (Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24),
        );
        const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
        return {
          value: key,
          label: `${pc.cyan(key)} (${ws.provider}, last used ${ageStr})`,
        };
      });

      // Allow multi-select
      const selected = await p.multiselect({
        message: 'Select workspaces to destroy (space to select, enter to confirm)',
        options: choices,
      });

      if (p.isCancel(selected) || (selected as string[]).length === 0) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      // Destroy each selected workspace
      for (const workspaceId of selected as string[]) {
        await workspaceDestroy(workspaceId);
      }
    } else {
      // Direct destroy with provided ID
      await workspaceDestroy(id);
    }
  });

workspaceCmd
  .command('connect')
  .alias('attach')  // Keep attach as alias
  .description('Connect to an existing workspace (with git context)')
  .argument('[id]', 'Workspace ID (optional - will show picker if not provided)')
  .action(async (id: string | undefined) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    // If no ID provided, show interactive picker
    if (!id) {
      const state = loadWorkspaceState();
      const workspaceIds = Object.keys(state.workspaces);

      if (workspaceIds.length === 0) {
        p.log.info('No workspaces found.');
        p.log.info('Create one with: compute create owner/repo');
        p.outro(pc.green('Done!'));
        return;
      }

      const choices = workspaceIds.map((key) => {
        const ws = state.workspaces[key];
        const age = Math.round(
          (Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24),
        );
        const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
        return {
          value: key,
          label: `${pc.cyan(key)} (${ws.provider}, last used ${ageStr})`,
        };
      });

      const selected = await p.select({
        message: 'Select workspace to connect',
        options: choices,
      });

      if (p.isCancel(selected)) {
        p.cancel('Cancelled');
        process.exit(0);
      }

      id = selected as string;
    }

    await workspaceAttach(id);
  });

// ─── run ─────────────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Create a sandbox, run a command, then optionally destroy it')
  .argument('<command...>', 'command to run')
  .option('-p, --provider <provider>', 'provider to use')
  .option('-e, --env <key=value...>', 'environment variables')
  .option('-w, --workdir <directory>', 'working directory')
  .passThroughOptions()
  .option('--rm', 'destroy sandbox after command finishes')
  .option('--timeout <duration>', 'sandbox timeout (e.g. 5m, 1h)')
  .option('--name <name>', 'sandbox name')
  .action(async (command: string[], opts) => {
    await ensureAuth();
    const provider = await resolveProvider(opts.provider);
    configureCompute(provider);

    let sandbox: SandboxInterface;
    try {
      sandbox = await compute.sandbox.create(
        buildCreateOptions(opts),
      );
    } catch (error) {
      console.error(pc.red(`Failed to create sandbox: ${(error as Error).message}`));
      process.exit(1);
    }

    try {
      const cmd = buildExecCommand(command, opts);
      const result = await sandbox.runCommand(cmd);

      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }

      if (opts.rm) {
        await sandbox.destroy();
      }

      process.exit(result.exitCode);
    } catch (error) {
      if (opts.rm) {
        try { await sandbox.destroy(); } catch { /* ignore cleanup errors */ }
      }
      console.error(pc.red((error as Error).message));
      process.exit(1);
    }
  });

// ─── providers ───────────────────────────────────────────────────────────────

program
  .command('providers')
  .description('List all providers and their configuration status')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    const statuses = getProviderStatus();

    console.log();
    for (const status of statuses) {
      const icon = status.ready ? pc.green('●') : pc.gray('○');
      const name = status.ready ? pc.white(status.name) : pc.gray(status.name);
      const detail = status.ready
        ? pc.green('ready')
        : pc.gray(`missing: ${status.missing.join(', ')}`);
      console.log(`  ${icon} ${name}  ${detail}`);
    }
    console.log();
  });

// ─── login / logout ──────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with ComputeSDK')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    await ensureAuth({ forceLogin: true });
    p.outro(pc.green('Authenticated!'));
  });

program
  .command('logout')
  .description('Clear stored credentials')
  .action(() => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    clearStoredCredentials();
    p.log.success('Logged out. Stored credentials removed.');
    p.outro(pc.green('Done!'));
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────
// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCreateOptions(opts: { timeout?: string; name?: string }) {
  const options: Record<string, unknown> = {};
  if (opts.timeout) {
    options.timeout = parseDuration(opts.timeout);
  }
  if (opts.name) {
    options.name = opts.name;
  }
  return options;
}

export function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9._\-/:=@]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function buildExecCommand(
  command: string[],
  opts: { env?: string[]; workdir?: string },
): string {
  let cmd = command.map(shellEscape).join(' ');

  // Prepend cd if workdir is specified
  if (opts.workdir) {
    cmd = `cd ${shellEscape(opts.workdir)} && ${cmd}`;
  }

  // Prepend env vars if specified
  if (opts.env && opts.env.length > 0) {
    const envPrefix = opts.env
      .map((entry) => {
        const eqIndex = entry.indexOf('=');
        if (eqIndex === -1) {
          throw new Error(
            `Invalid environment entry "${entry}". Expected format KEY=VALUE.`,
          );
        }
        const key = entry.slice(0, eqIndex);
        const val = entry.slice(eqIndex + 1);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          throw new Error(
            `Invalid environment variable name "${key}" in entry "${entry}".`,
          );
        }
        return `${key}=${shellEscape(val)}`;
      })
      .join(' ');
    cmd = `${envPrefix} ${cmd}`;
  }

  return cmd;
}

/**
 * Parse a human-friendly duration string to milliseconds.
 * Supports: 30s, 5m, 1h, 2h30m
 */
function parseDuration(input: string): number {
  let total = 0;
  const pattern = /(\d+)\s*(s|m|h)/gi;
  let match;

  while ((match = pattern.exec(input)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 's': total += value * 1000; break;
      case 'm': total += value * 60 * 1000; break;
      case 'h': total += value * 60 * 60 * 1000; break;
    }
  }

  if (total === 0) {
    // Try as plain number (seconds)
    const num = parseInt(input, 10);
    if (!isNaN(num)) return num * 1000;
    throw new Error(`Invalid duration: ${input}. Use formats like 30s, 5m, 1h`);
  }

  return total;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((error) => {
  console.error(pc.red(`\nError: ${error.message}`));
  process.exit(1);
});

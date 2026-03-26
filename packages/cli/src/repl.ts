/**
 * REPL Mode - Run commands one at a time
 *
 * Shell-like interface where each line is executed as a command.
 * Special commands prefixed with /.
 */

import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import pc from 'picocolors';
import { compute, type Sandbox } from 'computesdk';
import { startPTY } from './pty.js';

type SessionResult = 'exit' | 'shell';

interface ReplContext {
  sandboxes: Map<string, Sandbox>;
  activeSandboxId: string;
}

/**
 * Start REPL mode
 *
 * Loops between REPL sessions and PTY sessions.
 * Each /shell command closes the readline cleanly, runs PTY,
 * then creates a fresh readline on return.
 *
 * Returns all sandboxes that are still alive so the caller can clean them up.
 */
export async function startREPL(sandbox: Sandbox, provider: string): Promise<void> {
  // Mark provider as used - reserved for future provider-specific REPL behavior
  void provider;
  const ctx: ReplContext = {
    sandboxes: new Map([[sandbox.sandboxId, sandbox]]),
    activeSandboxId: sandbox.sandboxId,
  };

  while (true) {
    const result = await runSession(ctx);
    if (result === 'exit') break;

    // result === 'shell' — drop into PTY, then loop back
    const activeSandbox = ctx.sandboxes.get(ctx.activeSandboxId)!;
    console.log(pc.gray('  Entering PTY shell... (.exit or Ctrl+D to return to REPL)'));
    console.log();
    // Clear screen for clean PTY session
    process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
    await startPTY(activeSandbox);
    console.log(pc.gray('  Back in REPL.'));
  }

}

function buildPrompt(sandboxId: string): string {
  if (!sandboxId) return pc.gray('[no sandbox] ') + pc.bold('$ ');
  return pc.cyan(`[${sandboxId}] `) + pc.bold('$ ');
}

/**
 * Run a single REPL session.
 *
 * Creates a readline interface, processes commands, and returns
 * 'exit' when the user wants to quit or 'shell' when they want PTY.
 */
function runSession(ctx: ReplContext): Promise<SessionResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(ctx.activeSandboxId),
    terminal: true,
    historySize: 1000,
  });

  // Load history
  loadHistory(rl);

  return new Promise<SessionResult>((resolve) => {
    let resolved = false;
    const done = (result: SessionResult) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(result);
    };

    rl.on('SIGINT', () => {
      console.log();
      rl.prompt();
    });

    rl.on('close', () => {
      done('exit');
    });

    rl.on('line', async (line: string) => {
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === '.exit') {
        done('exit');
        return;
      }

      // Save to history
      saveToHistory(trimmed);

      try {
        if (trimmed.startsWith('/')) {
          const result = await handleSpecialCommand(ctx, trimmed, rl);
          if (result === 'exit' || result === 'shell') {
            done(result);
            return;
          }
        } else if (ctx.sandboxes.size === 0) {
          console.log(pc.yellow('No active sandbox. Use /new to create one.'));
        } else {
          const sandbox = ctx.sandboxes.get(ctx.activeSandboxId)!;
          await executeCommand(sandbox, trimmed);
        }
      } catch (error) {
        console.log(pc.red(`✗ ${(error as Error).message}`));
      }

      if (!resolved) {
        rl.prompt();
      }
    });

    rl.prompt();
  });
}

/**
 * Execute a shell command in the sandbox
 */
async function executeCommand(sandbox: Sandbox, command: string): Promise<void> {
  const result = await sandbox.runCommand(command);

  // Print stdout
  if (result.stdout) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith('\n')) {
      console.log();
    }
  }

  // Print stderr in red
  if (result.stderr) {
    process.stderr.write(pc.red(result.stderr));
    if (!result.stderr.endsWith('\n')) {
      console.log();
    }
  }

  // Show exit code if non-zero
  if (result.exitCode !== 0) {
    console.log(pc.gray(`exit code: ${result.exitCode}`));
  }
}

/**
 * Handle special commands (prefixed with /)
 * Returns 'exit' to quit, 'shell' for PTY, or null to continue
 */
async function handleSpecialCommand(
  ctx: ReplContext,
  input: string,
  rl: readline.Interface,
): Promise<SessionResult | null> {
  const [cmd, ...args] = input.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'help':
    case 'h':
    case '?':
      showHelp();
      return null;

    case 'info':
    case 'i': {
      if (ctx.sandboxes.size === 0) {
        console.log(pc.yellow('No active sandbox. Use /new to create one.'));
        return null;
      }
      const activeSandbox = ctx.sandboxes.get(ctx.activeSandboxId)!;
      console.log();
      console.log(pc.bold('  Sandbox Info'));
      console.log(`  ID: ${pc.cyan(activeSandbox.sandboxId)}`);
      console.log();
      return null;
    }

    case 'url':
    case 'u': {
      if (ctx.sandboxes.size === 0) {
        console.log(pc.yellow('No active sandbox. Use /new to create one.'));
        return null;
      }
      const activeSandbox = ctx.sandboxes.get(ctx.activeSandboxId)!;
      if (args.length === 0) {
        console.log(pc.gray('Usage: /url <port>'));
      } else {
        const port = parseInt(args[0], 10);
        if (isNaN(port)) {
          console.log(pc.red('Invalid port number'));
        } else {
          const url = await activeSandbox.getUrl({ port });
          console.log(pc.cyan(url));
        }
      }
      return null;
    }

    case 'new': {
      console.log(pc.gray('  Creating new sandbox...'));
      const newSandbox = await compute.sandbox.create();
      ctx.sandboxes.set(newSandbox.sandboxId, newSandbox);
      ctx.activeSandboxId = newSandbox.sandboxId;
      rl.setPrompt(buildPrompt(ctx.activeSandboxId));
      console.log(`  Sandbox ready: ${pc.cyan(newSandbox.sandboxId)}`);
      console.log(`  ${pc.gray(`Active sandboxes: ${ctx.sandboxes.size}`)}`);
      return null;
    }

    case 'destroy': {
      if (args.length === 0) {
        console.log(pc.gray('Usage: /destroy <sandbox-id> or /destroy --all'));
        console.log(pc.gray('Use /list to see all sandboxes'));
        return null;
      }
      if (args[0] === '--all') {
        if (ctx.sandboxes.size === 0) {
          console.log(pc.yellow('  No sandboxes to destroy.'));
          return null;
        }
        const count = ctx.sandboxes.size;
        console.log(pc.gray(`  Destroying ${count} sandbox${count > 1 ? 'es' : ''}...`));
        await Promise.all(
          Array.from(ctx.sandboxes.values()).map(s => s.destroy()),
        );
        ctx.sandboxes.clear();
        ctx.activeSandboxId = '';
        rl.setPrompt(buildPrompt(ctx.activeSandboxId));
        console.log(`  Destroyed ${pc.cyan(String(count))} sandbox${count > 1 ? 'es' : ''}`);
        console.log(pc.yellow('  No sandboxes remaining. Use /new to create one or /exit to quit.'));
        return null;
      }
      const targetId = args[0];
      const target = ctx.sandboxes.get(targetId);
      if (!target) {
        // Try partial match
        const matches = Array.from(ctx.sandboxes.keys()).filter(id => id.startsWith(targetId));
        if (matches.length === 1) {
          return destroySandbox(ctx, matches[0], rl);
        } else if (matches.length > 1) {
          console.log(pc.yellow('  Ambiguous ID. Matches:'));
          for (const id of matches) {
            console.log(`    ${pc.cyan(id)}`);
          }
        } else {
          console.log(pc.red(`  Sandbox not found: ${targetId}`));
          console.log(pc.gray('  Use /list to see all sandboxes'));
        }
        return null;
      }
      return destroySandbox(ctx, targetId, rl);
    }

    case 'list':
    case 'ls': {
      console.log();
      console.log(pc.bold('  Sandboxes'));
      for (const id of ctx.sandboxes.keys()) {
        const marker = id === ctx.activeSandboxId ? pc.green(' ●') : '  ';
        console.log(`  ${marker} ${pc.cyan(id)}`);
      }
      console.log();
      return null;
    }

    case 'switch':
    case 'sw': {
      if (args.length === 0) {
        console.log(pc.gray('Usage: /switch <sandbox-id>'));
        console.log(pc.gray('Use /list to see all sandboxes'));
        return null;
      }
      const switchId = args[0];
      if (ctx.sandboxes.has(switchId)) {
        ctx.activeSandboxId = switchId;
        rl.setPrompt(buildPrompt(ctx.activeSandboxId));
        console.log(`  Switched to ${pc.cyan(switchId)}`);
        return null;
      }
      // Try partial match
      const matches = Array.from(ctx.sandboxes.keys()).filter(id => id.startsWith(switchId));
      if (matches.length === 1) {
        ctx.activeSandboxId = matches[0];
        rl.setPrompt(buildPrompt(ctx.activeSandboxId));
        console.log(`  Switched to ${pc.cyan(matches[0])}`);
      } else if (matches.length > 1) {
        console.log(pc.yellow('  Ambiguous ID. Matches:'));
        for (const id of matches) {
          console.log(`    ${pc.cyan(id)}`);
        }
      } else {
        console.log(pc.red(`  Sandbox not found: ${switchId}`));
        console.log(pc.gray('  Use /list to see all sandboxes'));
      }
      return null;
    }

    case 'shell':
    case 'sh':
      if (ctx.sandboxes.size === 0) {
        console.log(pc.yellow('No active sandbox. Use /new to create one.'));
        return null;
      }
      return 'shell';

    case 'exit':
    case 'quit':
    case 'q':
      return 'exit';

    default:
      console.log(pc.yellow(`Unknown command: /${cmd}`));
      console.log(pc.gray('Type /help for available commands'));
      return null;
  }
}

/**
 * Destroy a sandbox by ID and update context
 */
async function destroySandbox(
  ctx: ReplContext,
  sandboxId: string,
  rl: readline.Interface,
): Promise<null> {
  const target = ctx.sandboxes.get(sandboxId)!;
  console.log(pc.gray(`  Destroying ${sandboxId}...`));
  await target.destroy();
  ctx.sandboxes.delete(sandboxId);
  console.log(`  Destroyed ${pc.cyan(sandboxId)}`);

  // If we destroyed the active sandbox, switch to another
  if (ctx.activeSandboxId === sandboxId && ctx.sandboxes.size > 0) {
    ctx.activeSandboxId = ctx.sandboxes.keys().next().value!;
    rl.setPrompt(buildPrompt(ctx.activeSandboxId));
    console.log(`  Switched to ${pc.cyan(ctx.activeSandboxId)}`);
  } else if (ctx.sandboxes.size === 0) {
    ctx.activeSandboxId = '';
    rl.setPrompt(buildPrompt(ctx.activeSandboxId));
    console.log(pc.yellow('  No sandboxes remaining. Use /new to create one or /exit to quit.'));
  }

  return null;
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log();
  console.log(pc.bold('  Shell Mode'));
  console.log(pc.gray('  Just type commands - they run in the active sandbox'));
  console.log();
  console.log(pc.white('    ls -la'));
  console.log(pc.white('    cat /etc/os-release'));
  console.log(pc.white('    npm install lodash'));
  console.log();
  console.log(pc.bold('  Sandbox Commands') + pc.gray(' (prefix with /)'));
  console.log();
  console.log(pc.cyan('    /new') + pc.gray('              Create a new sandbox and switch to it'));
  console.log(pc.cyan('    /list') + pc.gray('             List all sandboxes'));
  console.log(pc.cyan('    /switch <id>') + pc.gray('      Switch active sandbox'));
  console.log(pc.cyan('    /destroy <id>') + pc.gray('     Destroy a sandbox by ID'));
  console.log(pc.cyan('    /destroy --all') + pc.gray('    Destroy all sandboxes'));
  console.log();
  console.log(pc.bold('  Other Commands'));
  console.log();
  console.log(pc.cyan('    /shell') + pc.gray('            Drop into interactive PTY (vim, htop, etc.)'));
  console.log(pc.cyan('    /info') + pc.gray('             Show active sandbox info'));
  console.log(pc.cyan('    /url <port>') + pc.gray('       Get public URL for port'));
  console.log(pc.cyan('    /help') + pc.gray('             Show this help'));
  console.log(pc.cyan('    /exit') + pc.gray('             Exit the REPL'));
  console.log();
}

// History file path
const HISTORY_FILE = path.join(os.homedir(), '.create_compute_history');

/**
 * Load history from file
 */
function loadHistory(rl: readline.Interface): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const history = fs.readFileSync(HISTORY_FILE, 'utf-8')
        .split('\n')
        .filter(line => line.trim())
        .reverse();

      for (const line of history.slice(0, 1000)) {
        (rl as unknown as { history: string[] }).history?.push(line);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Save a line to history
 */
function saveToHistory(line: string): void {
  try {
    fs.appendFileSync(HISTORY_FILE, line + '\n');
  } catch {
    // Ignore
  }
}

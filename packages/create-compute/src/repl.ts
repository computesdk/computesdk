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
import type { Sandbox } from 'computesdk';

/**
 * Start REPL mode
 */
export async function startREPL(sandbox: Sandbox, provider: string): Promise<void> {
  const sandboxId = sandbox.sandboxId;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: pc.cyan(`[${sandboxId}] `) + pc.bold('$ '),
    terminal: true,
    historySize: 1000,
  });

  // Load history
  loadHistory(rl);

  return new Promise<void>((resolve) => {
    // Handle Ctrl+C and Ctrl+D
    rl.on('SIGINT', () => {
      // Ctrl+C - just show new prompt
      console.log();
      rl.prompt();
    });
    
    rl.on('close', () => {
      // Ctrl+D or .exit
      resolve();
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        rl.prompt();
        return;
      }

      // Handle .exit
      if (trimmed === '.exit') {
        rl.close();
        resolve();
        return;
      }

      // Save to history
      saveToHistory(trimmed);

      try {
        // Check for special commands (start with /)
        if (trimmed.startsWith('/')) {
          const shouldExit = await handleSpecialCommand(sandbox, trimmed, rl);
          if (shouldExit) {
            rl.close();
            resolve();
            return;
          }
        } else {
          // Execute as shell command
          await executeCommand(sandbox, trimmed);
        }
      } catch (error) {
        console.log(pc.red(`✗ ${(error as Error).message}`));
      }

      rl.prompt();
    });

    rl.on('close', () => {
      resolve();
    });

    // Start prompting
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
 * Returns true if should exit
 */
async function handleSpecialCommand(
  sandbox: Sandbox,
  input: string,
  rl: readline.Interface
): Promise<boolean> {
  const [cmd, ...args] = input.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'help':
    case 'h':
    case '?':
      showHelp();
      return false;

    case 'info':
    case 'i':
      console.log();
      console.log(pc.bold('  Sandbox Info'));
      console.log(`  ID: ${pc.cyan(sandbox.sandboxId)}`);
      console.log();
      return false;

    case 'url':
    case 'u':
      if (args.length === 0) {
        console.log(pc.gray('Usage: /url <port>'));
      } else {
        const port = parseInt(args[0], 10);
        if (isNaN(port)) {
          console.log(pc.red('Invalid port number'));
        } else {
          const url = await sandbox.getUrl({ port });
          console.log(pc.cyan(url));
        }
      }
      return false;

    case 'exit':
    case 'quit':
    case 'q':
      return true;

    default:
      console.log(pc.yellow(`Unknown command: /${cmd}`));
      console.log(pc.gray('Type /help for available commands'));
      return false;
  }
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log();
  console.log(pc.bold('  Shell Mode'));
  console.log(pc.gray('  Just type commands - they run in the sandbox'));
  console.log();
  console.log(pc.white('    ls -la'));
  console.log(pc.white('    cat /etc/os-release'));
  console.log(pc.white('    npm install lodash'));
  console.log();
  console.log(pc.bold('  Special Commands') + pc.gray(' (prefix with /)'));
  console.log();
  console.log(pc.cyan('    /help') + pc.gray('        Show this help'));
  console.log(pc.cyan('    /info') + pc.gray('        Show sandbox info'));
  console.log(pc.cyan('    /url 3000') + pc.gray('    Get public URL for port'));
  console.log(pc.cyan('    /exit') + pc.gray('        Exit and cleanup'));
  console.log(pc.cyan('    .exit') + pc.gray('        Exit and cleanup'));
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

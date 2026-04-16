/**
 * PTY Mode - Full interactive shell session
 *
 * Connects stdin/stdout directly to a remote PTY terminal.
 * Disconnect naturally with 'exit' or Ctrl+D (like SSH).
 */

import type { SandboxInterface } from 'computesdk';

export interface PTYOptions {
  /** Optional initial command to run before interactive shell (e.g., 'cd /path') */
  initialCommand?: string;
}

/**
 * Start PTY mode - interactive shell session
 * Uses /bin/bash for full shell features (history, completion, etc.)
 */
export async function startPTY(sandbox: SandboxInterface, options: PTYOptions = {}): Promise<void> {
  // Use bash explicitly for interactive features (history, tab completion, etc.)
  const terminal = await sandbox.terminal.create({ pty: true, shell: '/bin/bash' });

  // Small delay to ensure terminal is fully initialized
  await new Promise(resolve => setTimeout(resolve, 100));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  let exiting = false;
  let resolvePromise: () => void;

  // Send initial command if provided (e.g., cd to worktree)
  if (options.initialCommand) {
    terminal.write(options.initialCommand + '\n');
    // Small delay to let command execute before showing prompt
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Listen for WebSocket close (happens when bash exits naturally)
  const ws = (terminal as any)._ws;
  if (ws) {
    ws.on('close', () => {
      if (!exiting) {
        doExit();
      }
    });
  }

  terminal.on('output', (data: string) => {
    // Ignore output if we're exiting (bash sends newlines on exit)
    if (!exiting) {
      process.stdout.write(data);
    }
  });

  terminal.on('error', (error: string) => {
    // When bash exits, server sends error: undefined
    // Treat this as a natural exit signal
    if (!error || error === 'undefined') {
      if (!exiting) {
        doExit();
      }
      return;
    }
    // Only show error if it's meaningful
    process.stderr.write(`\r\nTerminal error: ${error}\r\n`);
  });

  const onData = (data: Buffer) => {
    // Send all input to remote terminal (including Ctrl+C)
    // Disconnect naturally with 'exit' or Ctrl+D
    terminal.write(data.toString());
  };
  process.stdin.on('data', onData);

  const onResize = () => {
    if (process.stdout.columns && process.stdout.rows) {
      try {
        terminal.resize(process.stdout.columns, process.stdout.rows);
      } catch {
        // Ignore resize errors
      }
    }
  };
  process.stdout.on('resize', onResize);
  onResize();

  async function doExit() {
    if (exiting) return;
    exiting = true;

    cleanup();
    try {
      await terminal.destroy();
    } catch {
      // Ignore
    }
    // Resolve the promise to return control to caller (don't exit process)
    // This allows REPL and other callers to continue after PTY session ends
    if (resolvePromise) {
      resolvePromise();
    }
  }

  function cleanup() {
    process.stdin.removeListener('data', onData);
    process.stdout.removeListener('resize', onResize);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    // No "Disconnected" message - clean exit like SSH
  }

  return new Promise<void>((resolve) => {
    resolvePromise = resolve;

    terminal.on('destroyed', () => {
      if (!exiting) {
        cleanup();
        resolve();
      }
    });

    process.stdin.on('end', () => {
      doExit();
    });
  });
}

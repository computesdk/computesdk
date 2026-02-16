/**
 * PTY Mode - Full interactive shell session
 *
 * Connects stdin/stdout directly to a remote PTY terminal.
 * Like SSH, but to a cloud sandbox.
 */

import type { Sandbox } from 'computesdk';

// Control characters
const CTRL_D = 0x04;

/**
 * Start PTY mode - interactive shell session
 */
export async function startPTY(sandbox: Sandbox): Promise<void> {
  // Create PTY terminal
  const terminal = await sandbox.terminal.create({ pty: true });

  // Set up stdin in raw mode for passthrough
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  // Buffer to detect ".exit" command
  let inputBuffer = '';

  // Pipe terminal output to stdout
  terminal.on('output', (data: string) => {
    process.stdout.write(data);
  });

  terminal.on('error', (error: string) => {
    process.stderr.write(`\r\nTerminal error: ${error}\r\n`);
  });

  // Pipe stdin to terminal, with .exit and Ctrl+D detection
  const onData = (data: Buffer) => {
    const str = data.toString();
    
    // Check for Ctrl+D
    if (data.length === 1 && data[0] === CTRL_D) {
      doExit();
      return;
    }
    
    // Add to buffer
    inputBuffer += str;
    
    // Check for .exit at end of buffer (after Enter)
    if (inputBuffer.endsWith('.exit\r') || inputBuffer.endsWith('.exit\n')) {
      doExit();
      return;
    }
    
    // Keep buffer small - only track last 10 chars
    if (inputBuffer.length > 10) {
      inputBuffer = inputBuffer.slice(-10);
    }
    
    // Pass through to terminal
    terminal.write(str);
  };
  process.stdin.on('data', onData);

  // Handle terminal resize
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

  // Initial resize
  onResize();

  let exiting = false;

  async function doExit() {
    if (exiting) return;
    exiting = true;
    
    cleanup();
    try {
      await terminal.destroy();
    } catch {
      // Ignore
    }
    resolvePromise();
  }

  function cleanup() {
    process.stdin.removeListener('data', onData);
    process.stdout.removeListener('resize', onResize);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    console.log(); // New line after PTY
  }

  let resolvePromise: () => void;

  // Wait for terminal to close
  return new Promise<void>((resolve) => {
    resolvePromise = resolve;

    terminal.on('destroyed', () => {
      if (!exiting) {
        cleanup();
        resolve();
      }
    });

    // Handle stdin end
    process.stdin.on('end', () => {
      doExit();
    });
  });
}

/**
 * WebContainerProcess adapter for computesdk
 * 
 * Provides a WebContainer-compatible process interface that wraps
 * computesdk terminal sessions.
 */

import type { Sandbox, TerminalInstance } from 'computesdk';
import type { WebContainerProcess, SpawnOptions } from './types';

/**
 * Creates a WebContainerProcess from a computesdk terminal
 */
export function createWebContainerProcess(
  terminal: TerminalInstance,
  sandbox: Sandbox,
  options?: SpawnOptions
): WebContainerProcess {
  let exitResolve: (code: number) => void;
  let exitReject: (error: Error) => void;
  
  const exitPromise = new Promise<number>((resolve, reject) => {
    exitResolve = resolve;
    exitReject = reject;
  });

  // Create output stream
  let outputController: ReadableStreamDefaultController<string> | null = null;
  const outputStream = new ReadableStream<string>({
    start(controller) {
      outputController = controller;
    },
    cancel() {
      outputController = null;
    }
  });

  // Create input stream
  const inputStream = new WritableStream<string>({
    write(chunk) {
      terminal.write(chunk);
    }
  });

  // Set up terminal output handler if output is enabled (default: true)
  if (options?.output !== false) {
    terminal.on('output', (data: string) => {
      if (outputController) {
        outputController.enqueue(data);
      }
    });
  }

  // Track exit status
  let killed = false;

  // Handle terminal close/exit
  terminal.on('exit', (code: number) => {
    if (outputController) {
      outputController.close();
    }
    exitResolve(code);
  });

  return {
    exit: exitPromise,
    input: inputStream,
    output: outputStream,

    kill() {
      if (!killed) {
        killed = true;
        terminal.destroy().catch(() => {});
        if (outputController) {
          outputController.close();
        }
        exitResolve(137); // SIGKILL
      }
    },

    resize(dimensions: { cols: number; rows: number }) {
      terminal.resize(dimensions.cols, dimensions.rows);
    }
  };
}

/**
 * Spawns a process in the sandbox and returns a WebContainerProcess
 */
export async function spawnProcess(
  sandbox: Sandbox,
  command: string,
  args: string[] = [],
  options?: SpawnOptions
): Promise<WebContainerProcess> {
  // Build the full command
  const fullCommand = args.length > 0 
    ? `${command} ${args.map(arg => {
        // Quote arguments that contain spaces or special characters
        if (/[\s"'\\$`!]/.test(arg)) {
          return `"${arg.replace(/["\\$`!]/g, '\\$&')}"`;
        }
        return arg;
      }).join(' ')}`
    : command;

  // Create a PTY terminal for the process
  const terminal = await sandbox.terminal.create({
    pty: true,
    shell: '/bin/sh',
    encoding: 'raw',
  });

  // Set terminal size if specified
  if (options?.terminal) {
    terminal.resize(options.terminal.cols, options.terminal.rows);
  }

  // Create the process wrapper
  const process = createWebContainerProcess(terminal, sandbox, options);

  // Execute the command
  // We need to handle the command execution and capture the exit code
  const envVars = options?.env 
    ? Object.entries(options.env)
        .map(([k, v]) => `export ${k}="${String(v).replace(/"/g, '\\"')}"`)
        .join('; ') + '; '
    : '';
  
  const cwdPrefix = options?.cwd ? `cd "${options.cwd}" && ` : '';
  
  // Write the command to execute and capture exit code
  // Use a special exit handler to capture the exit code
  terminal.write(`${envVars}${cwdPrefix}${fullCommand}; exit $?\n`);

  return process;
}

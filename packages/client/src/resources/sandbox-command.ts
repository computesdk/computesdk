/**
 * SandboxCommand - Convenience namespace for one-shot command execution
 */

import { Command } from './command';

/**
 * Command execution result for one-shot commands
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * SandboxCommand - Convenience namespace for running commands without managing terminals
 *
 * @example
 * ```typescript
 * // Run a one-shot command
 * const result = await sandbox.command.run('npm test');
 * console.log(result.stdout);
 * console.log(result.exitCode);
 *
 * // Run with options
 * const result = await sandbox.command.run('npm install', {
 *   background: true,
 * });
 * ```
 */
export class SandboxCommand {
  private runHandler: (
    command: string,
    options?: { background?: boolean }
  ) => Promise<CommandResult>;

  constructor(handlers: {
    run: (
      command: string,
      options?: { background?: boolean }
    ) => Promise<CommandResult>;
  }) {
    this.runHandler = handlers.run;
  }

  /**
   * Run a one-shot command
   *
   * This is a convenience method that:
   * 1. Creates an ephemeral exec terminal
   * 2. Runs the command
   * 3. Waits for completion (unless background: true)
   * 4. Cleans up the terminal
   * 5. Returns the result
   *
   * @param command - The command to execute
   * @param options - Execution options
   * @param options.background - If true, returns immediately without waiting
   * @returns Command result
   */
  async run(
    command: string,
    options?: { background?: boolean }
  ): Promise<CommandResult> {
    return this.runHandler(command, options);
  }
}

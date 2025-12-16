/**
 * Commands - Resource namespace for terminal commands
 */

import { Command } from './command';
import type { CommandsListResponse, CommandDetailsResponse, CommandExecutionResponse } from '../index';

/**
 * Commands resource namespace for a terminal
 *
 * @example
 * ```typescript
 * const terminal = await sandbox.terminals.create({ pty: false });
 *
 * // Run a command
 * const cmd = await terminal.commands.run('npm test');
 * console.log(cmd.stdout);
 *
 * // Run in background and wait
 * const cmd = await terminal.commands.run('npm install', { background: true });
 * await cmd.wait();
 * console.log(cmd.exitCode);
 *
 * // List commands
 * const commands = await terminal.commands.list();
 *
 * // Retrieve a specific command
 * const cmd = await terminal.commands.retrieve(cmdId);
 * ```
 */
export class TerminalCommands {
  private terminalId: string;
  private runHandler: (command: string, background?: boolean) => Promise<CommandExecutionResponse>;
  private listHandler: () => Promise<CommandsListResponse>;
  private retrieveHandler: (cmdId: string) => Promise<CommandDetailsResponse>;
  private waitHandler: (cmdId: string, timeout?: number) => Promise<CommandDetailsResponse>;

  constructor(
    terminalId: string,
    handlers: {
      run: (command: string, background?: boolean) => Promise<CommandExecutionResponse>;
      list: () => Promise<CommandsListResponse>;
      retrieve: (cmdId: string) => Promise<CommandDetailsResponse>;
      wait: (cmdId: string, timeout?: number) => Promise<CommandDetailsResponse>;
    }
  ) {
    this.terminalId = terminalId;
    this.runHandler = handlers.run;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.waitHandler = handlers.wait;
  }

  /**
   * Run a command in the terminal
   * @param command - The command to execute
   * @param options - Execution options
   * @param options.background - If true, returns immediately without waiting for completion
   * @returns Command object with results or status
   */
  async run(command: string, options?: { background?: boolean }): Promise<Command> {
    const response = await this.runHandler(command, options?.background);

    const cmd = new Command({
      cmdId: response.data.cmd_id || '',
      terminalId: this.terminalId,
      command: response.data.command,
      status: response.data.status || (options?.background ? 'running' : 'completed'),
      stdout: response.data.stdout,
      stderr: response.data.stderr,
      exitCode: response.data.exit_code,
      durationMs: response.data.duration_ms,
      startedAt: new Date().toISOString(),
    });

    // Set up handlers for the command
    cmd.setWaitHandler((timeout) => this.waitHandler(cmd.id, timeout));
    cmd.setRetrieveHandler(() => this.retrieveHandler(cmd.id));

    return cmd;
  }

  /**
   * List all commands executed in this terminal
   * @returns Array of Command objects
   */
  async list(): Promise<Command[]> {
    const response = await this.listHandler();

    return response.data.commands.map((item) => {
      const cmd = new Command({
        cmdId: item.cmd_id,
        terminalId: this.terminalId,
        command: item.command,
        status: item.status,
        stdout: '', // Not included in list response
        stderr: '', // Not included in list response
        exitCode: item.exit_code,
        durationMs: item.duration_ms,
        startedAt: item.started_at,
        finishedAt: item.finished_at,
      });

      cmd.setWaitHandler((timeout) => this.waitHandler(cmd.id, timeout));
      cmd.setRetrieveHandler(() => this.retrieveHandler(cmd.id));

      return cmd;
    });
  }

  /**
   * Retrieve a specific command by ID
   * @param cmdId - The command ID
   * @returns Command object with full details
   */
  async retrieve(cmdId: string): Promise<Command> {
    const response = await this.retrieveHandler(cmdId);

    const cmd = new Command({
      cmdId: response.data.cmd_id,
      terminalId: this.terminalId,
      command: response.data.command,
      status: response.data.status,
      stdout: response.data.stdout,
      stderr: response.data.stderr,
      exitCode: response.data.exit_code,
      durationMs: response.data.duration_ms,
      startedAt: response.data.started_at,
      finishedAt: response.data.finished_at,
    });

    cmd.setWaitHandler((timeout) => this.waitHandler(cmd.id, timeout));
    cmd.setRetrieveHandler(() => this.retrieveHandler(cmd.id));

    return cmd;
  }
}

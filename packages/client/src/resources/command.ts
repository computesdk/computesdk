/**
 * Command - Represents a command execution in a terminal
 */

import type { CommandDetailsResponse } from '../index';

/**
 * Command execution result with wait capability
 */
export class Command {
  readonly id: string;
  readonly terminalId: string;
  readonly command: string;
  private _status: 'running' | 'completed' | 'failed';
  private _stdout: string;
  private _stderr: string;
  private _exitCode?: number;
  private _durationMs?: number;
  private _startedAt: string;
  private _finishedAt?: string;

  private waitHandler?: (timeout?: number) => Promise<CommandDetailsResponse>;
  private retrieveHandler?: () => Promise<CommandDetailsResponse>;

  constructor(data: {
    cmdId: string;
    terminalId: string;
    command: string;
    status: 'running' | 'completed' | 'failed';
    stdout: string;
    stderr: string;
    exitCode?: number;
    durationMs?: number;
    startedAt: string;
    finishedAt?: string;
  }) {
    this.id = data.cmdId;
    this.terminalId = data.terminalId;
    this.command = data.command;
    this._status = data.status;
    this._stdout = data.stdout;
    this._stderr = data.stderr;
    this._exitCode = data.exitCode;
    this._durationMs = data.durationMs;
    this._startedAt = data.startedAt;
    this._finishedAt = data.finishedAt;
  }

  get status(): 'running' | 'completed' | 'failed' {
    return this._status;
  }

  get stdout(): string {
    return this._stdout;
  }

  get stderr(): string {
    return this._stderr;
  }

  get exitCode(): number | undefined {
    return this._exitCode;
  }

  get durationMs(): number | undefined {
    return this._durationMs;
  }

  get startedAt(): string {
    return this._startedAt;
  }

  get finishedAt(): string | undefined {
    return this._finishedAt;
  }

  /**
   * Set the wait handler (called by TerminalCommands)
   * @internal
   */
  setWaitHandler(handler: (timeout?: number) => Promise<CommandDetailsResponse>): void {
    this.waitHandler = handler;
  }

  /**
   * Set the retrieve handler (called by TerminalCommands)
   * @internal
   */
  setRetrieveHandler(handler: () => Promise<CommandDetailsResponse>): void {
    this.retrieveHandler = handler;
  }

  /**
   * Wait for the command to complete
   * @param timeout - Optional timeout in seconds (0 = no timeout)
   * @returns This command with updated status
   */
  async wait(timeout?: number): Promise<this> {
    if (!this.waitHandler) {
      throw new Error('Wait handler not set');
    }

    const response = await this.waitHandler(timeout);
    this.updateFromResponse(response);
    return this;
  }

  /**
   * Refresh the command status from the server
   * @returns This command with updated status
   */
  async refresh(): Promise<this> {
    if (!this.retrieveHandler) {
      throw new Error('Retrieve handler not set');
    }

    const response = await this.retrieveHandler();
    this.updateFromResponse(response);
    return this;
  }

  /**
   * Update internal state from API response
   */
  private updateFromResponse(response: CommandDetailsResponse): void {
    this._status = response.data.status;
    this._stdout = response.data.stdout;
    this._stderr = response.data.stderr;
    this._exitCode = response.data.exit_code;
    this._durationMs = response.data.duration_ms;
    this._finishedAt = response.data.finished_at;
  }
}

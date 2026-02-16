/**
 * Terminal - Resource namespace for terminal management
 */

import type { TerminalInstance } from '../terminal';
import type { TerminalResponse } from '../index';

/**
 * Terminal resource namespace
 *
 * @example
 * ```typescript
 * // Create a PTY terminal (interactive shell)
 * const pty = await sandbox.terminal.create({ pty: true, shell: '/bin/bash' });
 * pty.on('output', (data) => console.log(data));
 * pty.write('ls -la\n');
 *
 * // Create an exec terminal (command tracking)
 * const exec = await sandbox.terminal.create({ pty: false });
 * const cmd = await exec.command.run('npm test');
 * console.log(cmd.exitCode);
 *
 * // List all terminals
 * const terminals = await sandbox.terminal.list();
 *
 * // Retrieve a specific terminal
 * const terminal = await sandbox.terminal.retrieve(id);
 *
 * // Destroy a terminal
 * await sandbox.terminal.destroy(id);
 * ```
 */
export class Terminal {
  private createHandler: (options?: {
    shell?: string;
    encoding?: 'raw' | 'base64';
    pty?: boolean;
  }) => Promise<TerminalInstance>;
  private listHandler: () => Promise<TerminalResponse[]>;
  private retrieveHandler: (id: string) => Promise<TerminalInstance>;
  private destroyHandler: (id: string) => Promise<void>;

  constructor(handlers: {
    create: (options?: {
      shell?: string;
      encoding?: 'raw' | 'base64';
      pty?: boolean;
    }) => Promise<TerminalInstance>;
    list: () => Promise<TerminalResponse[]>;
    retrieve: (id: string) => Promise<TerminalInstance>;
    destroy: (id: string) => Promise<void>;
  }) {
    this.createHandler = handlers.create;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.destroyHandler = handlers.destroy;
  }

  /**
   * Create a new terminal session
   *
   * @param options - Terminal creation options
   * @param options.shell - Shell to use (e.g., '/bin/bash') - PTY mode only
   * @param options.encoding - Encoding: 'raw' (default) or 'base64' (binary-safe)
   * @param options.pty - Terminal mode: true = PTY (interactive), false = exec (command tracking)
   * @returns TerminalInstance
   */
  async create(options?: {
    shell?: string;
    encoding?: 'raw' | 'base64';
    pty?: boolean;
  }): Promise<TerminalInstance> {
    return this.createHandler(options);
  }

  /**
   * List all active terminals
   * @returns Array of terminal responses
   */
  async list(): Promise<TerminalResponse[]> {
    return this.listHandler();
  }

  /**
   * Retrieve a specific terminal by ID
   * @param id - The terminal ID
   * @returns Terminal instance
   */
  async retrieve(id: string): Promise<TerminalInstance> {
    return this.retrieveHandler(id);
  }

  /**
   * Destroy a terminal by ID
   * @param id - The terminal ID
   */
  async destroy(id: string): Promise<void> {
    return this.destroyHandler(id);
  }
}

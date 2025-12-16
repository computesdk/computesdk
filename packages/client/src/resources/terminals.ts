/**
 * Terminals - Resource namespace for terminal management
 */

import type { Terminal } from '../terminal';
import type { TerminalResponse } from '../index';

/**
 * Terminals resource namespace
 *
 * @example
 * ```typescript
 * // Create a PTY terminal (interactive shell)
 * const pty = await sandbox.terminals.create({ pty: true, shell: '/bin/bash' });
 * pty.on('output', (data) => console.log(data));
 * pty.write('ls -la\n');
 *
 * // Create an exec terminal (command tracking)
 * const exec = await sandbox.terminals.create({ pty: false });
 * const cmd = await exec.commands.run('npm test');
 * console.log(cmd.exitCode);
 *
 * // List all terminals
 * const terminals = await sandbox.terminals.list();
 *
 * // Retrieve a specific terminal
 * const terminal = await sandbox.terminals.retrieve(id);
 *
 * // Destroy a terminal
 * await sandbox.terminals.destroy(id);
 * ```
 */
export class Terminals {
  private createHandler: (options?: {
    shell?: string;
    encoding?: 'raw' | 'base64';
    pty?: boolean;
  }) => Promise<Terminal>;
  private listHandler: () => Promise<TerminalResponse[]>;
  private retrieveHandler: (id: string) => Promise<TerminalResponse>;
  private destroyHandler: (id: string) => Promise<void>;

  constructor(handlers: {
    create: (options?: {
      shell?: string;
      encoding?: 'raw' | 'base64';
      pty?: boolean;
    }) => Promise<Terminal>;
    list: () => Promise<TerminalResponse[]>;
    retrieve: (id: string) => Promise<TerminalResponse>;
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
   * @returns Terminal instance
   */
  async create(options?: {
    shell?: string;
    encoding?: 'raw' | 'base64';
    pty?: boolean;
  }): Promise<Terminal> {
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
   * @returns Terminal response
   */
  async retrieve(id: string): Promise<TerminalResponse> {
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

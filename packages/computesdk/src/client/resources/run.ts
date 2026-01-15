/**
 * Run - Resource namespace for code and command execution
 */

/**
 * Code execution result
 */
export interface CodeResult {
  output: string;
  exitCode: number;
  language: string;
}

/**
 * Command execution result
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** Command ID (present for background commands) */
  cmdId?: string;
  /** Terminal ID (present for background commands) */
  terminalId?: string;
  /** Command status (present for background commands) */
  status?: 'running' | 'completed' | 'failed';
}

/**
 * Supported languages for code execution
 */
export type CodeLanguage = 'python' | 'python3' | 'node' | 'javascript' | 'js' | 'bash' | 'sh' | 'ruby';

/**
 * Code execution options
 */
export interface CodeRunOptions {
  /** Programming language (optional - will auto-detect if not specified) */
  language?: CodeLanguage;
}

/**
 * Options for waiting for command completion
 */
export interface CommandWaitOptions {
  /** Timeout in seconds to wait for command completion (default: 300, max: 300) */
  timeoutSeconds?: number;
}

/**
 * Command execution options
 */
export interface CommandRunOptions {
  /** Shell to use (optional) */
  shell?: string;
  /** Run in background (optional) */
  background?: boolean;
  /** Working directory for the command (optional) */
  cwd?: string;
  /** Environment variables (optional) */
  env?: Record<string, string>;
  /** If true, wait for background command to complete before returning (default: false) */
  waitForCompletion?: boolean | CommandWaitOptions;
}

/**
 * Run - Resource namespace for executing code and commands
 *
 * @example
 * ```typescript
 * // Run code with auto-detection
 * const result = await sandbox.run.code('print("Hello from Python")');
 * console.log(result.output); // "Hello from Python\n"
 * console.log(result.language); // "python"
 *
 * // Run code with explicit language
 * const result = await sandbox.run.code('console.log("Hello")', { language: 'node' });
 *
 * // Run a command
 * const result = await sandbox.run.command('ls -la');
 * console.log(result.stdout);
 * console.log(result.exitCode);
 *
 * // Run a command in background and wait for completion
 * const result = await sandbox.run.command('npm install', {
 *   background: true,
 *   waitForCompletion: true, // blocks until command completes
 * });
 * console.log(result.exitCode);
 *
 * // Run in background without waiting (fire-and-forget)
 * const result = await sandbox.run.command('npm install', { background: true });
 * console.log(result.cmdId); // command ID for manual tracking
 * console.log(result.terminalId); // terminal ID for manual tracking
 * ```
 */
export class Run {
  private codeHandler: (code: string, options?: CodeRunOptions) => Promise<CodeResult>;
  private commandHandler: (command: string, options?: CommandRunOptions) => Promise<CommandResult>;
  private waitHandler?: (
    terminalId: string,
    cmdId: string,
    options?: CommandWaitOptions
  ) => Promise<CommandResult>;

  constructor(handlers: {
    code: (code: string, options?: CodeRunOptions) => Promise<CodeResult>;
    command: (command: string, options?: CommandRunOptions) => Promise<CommandResult>;
    wait?: (terminalId: string, cmdId: string, options?: CommandWaitOptions) => Promise<CommandResult>;
  }) {
    this.codeHandler = handlers.code;
    this.commandHandler = handlers.command;
    this.waitHandler = handlers.wait;
  }

  /**
   * Execute code with automatic language detection
   *
   * Supports: python, python3, node, javascript, js, bash, sh, ruby
   *
   * @param code - The code to execute
   * @param options - Execution options
   * @param options.language - Programming language (auto-detected if not specified)
   * @returns Code execution result with output, exit code, and detected language
   */
  async code(code: string, options?: CodeRunOptions): Promise<CodeResult> {
    return this.codeHandler(code, options);
  }

  /**
   * Execute a shell command
   *
   * @param command - The command to execute
   * @param options - Execution options
   * @param options.shell - Shell to use (optional)
   * @param options.background - Run in background (optional)
   * @param options.cwd - Working directory for the command (optional)
   * @param options.env - Environment variables (optional)
   * @param options.waitForCompletion - If true (with background), wait for command to complete
   * @returns Command execution result with stdout, stderr, exit code, and duration
   */
  async command(command: string, options?: CommandRunOptions): Promise<CommandResult> {
    const result = await this.commandHandler(command, options);

    // If waitForCompletion is requested for a background command, poll until complete
    if (options?.background && options?.waitForCompletion && result.cmdId && result.terminalId) {
      if (!this.waitHandler) {
        throw new Error('Wait handler not configured');
      }
      const waitOptions =
        typeof options.waitForCompletion === 'object' ? options.waitForCompletion : undefined;
      return this.waitHandler(result.terminalId, result.cmdId, waitOptions);
    }

    return result;
  }

  /**
   * Wait for a background command to complete
   *
   * Polls the command status with exponential backoff until the command
   * is complete or fails. Throws an error if the command fails or times out.
   *
   * @param terminalId - Terminal ID from background command result
   * @param cmdId - Command ID from background command result
   * @param options - Polling options
   * @returns Command result with final status
   * @throws Error if command fails or times out
   */
  async waitForCompletion(
    terminalId: string,
    cmdId: string,
    options?: CommandWaitOptions
  ): Promise<CommandResult> {
    if (!this.waitHandler) {
      throw new Error('Wait handler not configured');
    }
    return this.waitHandler(terminalId, cmdId, options);
  }
}

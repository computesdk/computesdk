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
 * Command execution options
 */
export interface CommandRunOptions {
  /** Shell to use (optional) */
  shell?: string;
  /** Run in background (optional) */
  background?: boolean;
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
 * ```
 */
export class Run {
  private codeHandler: (code: string, options?: CodeRunOptions) => Promise<CodeResult>;
  private commandHandler: (command: string, options?: CommandRunOptions) => Promise<CommandResult>;

  constructor(handlers: {
    code: (code: string, options?: CodeRunOptions) => Promise<CodeResult>;
    command: (command: string, options?: CommandRunOptions) => Promise<CommandResult>;
  }) {
    this.codeHandler = handlers.code;
    this.commandHandler = handlers.command;
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
   * @returns Command execution result with stdout, stderr, exit code, and duration
   */
  async command(command: string, options?: CommandRunOptions): Promise<CommandResult> {
    return this.commandHandler(command, options);
  }
}

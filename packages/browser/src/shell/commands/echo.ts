import type { ShellCommand, ShellCommandOptions, ShellCommandResult } from '../types.js'

export class EchoCommand implements ShellCommand {
  name = 'echo'
  description = 'Display text'

  async execute(args: string[], _options: ShellCommandOptions): Promise<ShellCommandResult> {
    // Join arguments with spaces
    let output = args.join(' ')
    
    // Process escape sequences (like real echo -e)
    // This preserves ANSI sequences and other escape codes for raw passthrough
    output = this.processEscapeSequences(output)
    
    return {
      stdout: output + '\n',
      stderr: '',
      exitCode: 0
    }
  }

  private processEscapeSequences(text: string): string {
    // Process only basic escape sequences, leave ANSI sequences as literal strings for raw passthrough
    // This allows ANSI sequences to pass through unprocessed while handling basic escapes like \n, \r
    return text
      .replace(/\\\\n/g, '\n')    // Newline (matches \\n - 2 literal backslashes + n)
      .replace(/\\\\r/g, '\r')    // Carriage return (matches \\r - 2 literal backslashes + r)
      .replace(/\\\\t/g, '\t')    // Tab (matches \\t - 2 literal backslashes + t)
      // Note: We intentionally do NOT process ANSI escape sequences like \\033, \\e, etc.
      // because the tests expect raw passthrough of ANSI sequences
  }
}
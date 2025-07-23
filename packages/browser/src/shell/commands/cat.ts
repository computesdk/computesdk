import type { ShellCommand, ShellCommandOptions, ShellCommandResult } from '../types.js'

export class CatCommand implements ShellCommand {
  name = 'cat'
  description = 'Display file contents'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return {
          stdout: '',
          stderr: 'cat: missing file operand\n',
          exitCode: 1
        }
      }

      let output = ''
      
      for (const arg of args) {
        const path = arg.startsWith('/') ? arg : `${options.cwd}/${arg}`.replace(/\/+/g, '/')
        
        try {
          const content = await options.filesystem.readFile(path)
          output += content
        } catch (error) {
          return {
            stdout: output,
            stderr: `cat: ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
            exitCode: 1
          }
        }
      }

      return {
        stdout: output,
        stderr: '',
        exitCode: 0
      }
    } catch (error) {
      return {
        stdout: '',
        stderr: `cat: ${error instanceof Error ? error.message : String(error)}\n`,
        exitCode: 1
      }
    }
  }
}
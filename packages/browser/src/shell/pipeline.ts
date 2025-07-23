import type { ParsedPipeline, ParsedCommand } from './parser.js'
import type { ShellCommandOptions, ShellCommandResult } from './types.js'
import { getCommand } from './commands/index.js'

export class PipelineExecutor {
  private filesystem: any
  private environment: any
  private runtimeManager: any

  constructor(filesystem: any, environment: any, runtimeManager?: any) {
    this.filesystem = filesystem
    this.environment = environment
    this.runtimeManager = runtimeManager
  }

  /**
   * Execute a parsed pipeline with pipes and redirection
   */
  async execute(pipeline: ParsedPipeline): Promise<ShellCommandResult> {
    if (pipeline.commands.length === 0) {
      return { stdout: '', stderr: '', exitCode: 0 }
    }

    try {
      // Handle single command (no pipes)
      if (pipeline.commands.length === 1) {
        return await this.executeSingleCommand(
          pipeline.commands[0], 
          '', // no stdin
          pipeline
        )
      }

      // Handle pipeline with multiple commands
      return await this.executePipeline(pipeline)
    } catch (error) {
      return {
        stdout: '',
        stderr: `Pipeline error: ${error instanceof Error ? error.message : String(error)}\n`,
        exitCode: 1
      }
    }
  }

  private async executeSingleCommand(
    command: ParsedCommand, 
    stdin: string,
    pipeline: ParsedPipeline
  ): Promise<ShellCommandResult> {
    const cmd = getCommand(command.command)
    
    if (!cmd) {
      return {
        stdout: '',
        stderr: `${command.command}: command not found\n`,
        exitCode: 127
      }
    }

    const options: ShellCommandOptions = {
      cwd: this.environment.cwd,
      env: this.environment.env,
      filesystem: this.filesystem,
      stdin,
      runtimeManager: this.runtimeManager
    }

    let result = await cmd.execute(command.args, options)

    // Handle output redirection
    if (pipeline.outputRedirect) {
      await this.handleOutputRedirection(result.stdout, pipeline.outputRedirect)
      result = { ...result, stdout: '' } // Clear stdout since it was redirected
    }

    // Handle cd command special case (update working directory)
    if (command.command === 'cd' && result.exitCode === 0 && (result as any).newCwd) {
      this.environment.cwd = (result as any).newCwd
      this.environment.env.PWD = (result as any).newCwd
    }

    return result
  }

  private async executePipeline(pipeline: ParsedPipeline): Promise<ShellCommandResult> {
    let currentInput = ''
    let finalResult: ShellCommandResult = { stdout: '', stderr: '', exitCode: 0 }

    // Handle input redirection for first command
    if (pipeline.inputRedirect) {
      try {
        currentInput = await this.filesystem.readFile(pipeline.inputRedirect.file)
      } catch (error) {
        return {
          stdout: '',
          stderr: `Cannot read input file '${pipeline.inputRedirect.file}': ${error}\n`,
          exitCode: 1
        }
      }
    }

    // Execute each command in the pipeline
    for (let i = 0; i < pipeline.commands.length; i++) {
      const command = pipeline.commands[i]
      // const isLastCommand = i === pipeline.commands.length - 1
      
      const cmd = getCommand(command.command)
      
      if (!cmd) {
        return {
          stdout: finalResult.stdout,
          stderr: finalResult.stderr + `${command.command}: command not found\n`,
          exitCode: 127
        }
      }

      const options: ShellCommandOptions = {
        cwd: this.environment.cwd,
        env: this.environment.env,
        filesystem: this.filesystem,
        stdin: currentInput,
        runtimeManager: this.runtimeManager
      }

      // Special handling for grep with stdin
      if (command.command === 'grep' && currentInput) {
        const result = await this.executeGrepWithStdin(command, currentInput, options)
        
        if (result.exitCode !== 0) {
          return {
            stdout: finalResult.stdout,
            stderr: finalResult.stderr + result.stderr,
            exitCode: result.exitCode
          }
        }
        
        currentInput = result.stdout
        finalResult.stderr += result.stderr
      } else {
        const result = await cmd.execute(command.args, options)
        
        if (result.exitCode !== 0) {
          return {
            stdout: finalResult.stdout,
            stderr: finalResult.stderr + result.stderr,
            exitCode: result.exitCode
          }
        }
        
        currentInput = result.stdout
        finalResult.stderr += result.stderr
      }

      // Handle cd command special case
      if (command.command === 'cd' && (finalResult as any).newCwd) {
        this.environment.cwd = (finalResult as any).newCwd
        this.environment.env.PWD = (finalResult as any).newCwd
      }
    }

    // Set final output
    finalResult.stdout = currentInput

    // Handle output redirection for final result
    if (pipeline.outputRedirect) {
      await this.handleOutputRedirection(finalResult.stdout, pipeline.outputRedirect)
      finalResult.stdout = '' // Clear stdout since it was redirected
    }

    return finalResult
  }

  private async executeGrepWithStdin(
    command: ParsedCommand, 
    stdin: string, 
    _options: ShellCommandOptions
  ): Promise<ShellCommandResult> {
    if (command.args.length === 0) {
      return { stdout: '', stderr: 'grep: missing pattern\n', exitCode: 1 }
    }

    const pattern = command.args[0]
    const lines = stdin.split('\n')
    let output = ''
    let hasMatches = false

    for (const line of lines) {
      if (line.includes(pattern)) {
        hasMatches = true
        output += line + '\n'
      }
    }

    return {
      stdout: output,
      stderr: '',
      exitCode: hasMatches ? 0 : 1
    }
  }

  private async handleOutputRedirection(
    output: string, 
    redirect: { type: '>' | '>>'; file: string }
  ): Promise<void> {
    try {
      const filePath = redirect.file.startsWith('/') 
        ? redirect.file 
        : `${this.environment.cwd}/${redirect.file}`.replace(/\/+/g, '/')

      if (redirect.type === '>') {
        // Overwrite file
        await this.filesystem.writeFile(filePath, output)
      } else {
        // Append to file
        try {
          const existing = await this.filesystem.readFile(filePath)
          await this.filesystem.writeFile(filePath, existing + output)
        } catch {
          // File doesn't exist, create it
          await this.filesystem.writeFile(filePath, output)
        }
      }
    } catch (error) {
      throw new Error(`Cannot redirect output to '${redirect.file}': ${error}`)
    }
  }
}
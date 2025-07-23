export interface ParsedCommand {
  command: string
  args: string[]
}

export interface ParsedPipeline {
  commands: ParsedCommand[]
  outputRedirect?: {
    type: '>' | '>>'
    file: string
  }
  inputRedirect?: {
    file: string
  }
}

export class ShellParser {
  /**
   * Parse a shell command line into a pipeline of commands
   * Supports: pipes (|), output redirection (>, >>), input redirection (<)
   */
  parse(commandLine: string): ParsedPipeline {
    const trimmed = commandLine.trim()
    if (!trimmed) {
      return { commands: [] }
    }

    // First, handle output redirection
    const { commands: commandsWithoutRedirect, outputRedirect, inputRedirect } = this.parseRedirection(trimmed)
    
    // Then parse pipes
    const pipeSegments = this.splitByPipes(commandsWithoutRedirect)
    
    const commands: ParsedCommand[] = []
    
    for (const segment of pipeSegments) {
      const parsed = this.parseCommand(segment.trim())
      if (parsed.command) {
        commands.push(parsed)
      }
    }

    return {
      commands,
      outputRedirect,
      inputRedirect
    }
  }

  private parseRedirection(commandLine: string): {
    commands: string
    outputRedirect?: { type: '>' | '>>'; file: string }
    inputRedirect?: { file: string }
  } {
    let commands = commandLine
    let outputRedirect: { type: '>' | '>>'; file: string } | undefined
    let inputRedirect: { file: string } | undefined

    // Handle output redirection (>> and >)
    const appendMatch = commands.match(/(.+?)\s*>>\s*(.+)$/)
    if (appendMatch) {
      commands = appendMatch[1].trim()
      outputRedirect = { type: '>>', file: appendMatch[2].trim() }
    } else {
      const redirectMatch = commands.match(/(.+?)\s*>\s*(.+)$/)
      if (redirectMatch) {
        commands = redirectMatch[1].trim()
        outputRedirect = { type: '>', file: redirectMatch[2].trim() }
      }
    }

    // Handle input redirection (<)
    const inputMatch = commands.match(/(.+?)\s*<\s*(.+)$/)
    if (inputMatch) {
      commands = inputMatch[1].trim()
      inputRedirect = { file: inputMatch[2].trim() }
    }

    return { commands, outputRedirect, inputRedirect }
  }

  private splitByPipes(commandLine: string): string[] {
    // Simple pipe splitting - doesn't handle quoted pipes
    return commandLine.split('|').map(segment => segment.trim())
  }

  private parseCommand(commandSegment: string): ParsedCommand {
    if (!commandSegment.trim()) {
      return { command: '', args: [] }
    }

    // Simple argument parsing - doesn't handle complex quoting
    const parts = this.parseArguments(commandSegment)
    
    return {
      command: parts[0] || '',
      args: parts.slice(1)
    }
  }

  private parseArguments(commandSegment: string): string[] {
    const args: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    
    for (let i = 0; i < commandSegment.length; i++) {
      const char = commandSegment[i]
      
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true
        quoteChar = char
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false
        quoteChar = ''
      } else if (!inQuotes && char === ' ') {
        if (current) {
          args.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }
    
    if (current) {
      args.push(current)
    }
    
    return args
  }

  /**
   * Check if a command line contains pipes or redirection
   */
  isComplex(commandLine: string): boolean {
    return commandLine.includes('|') || 
           commandLine.includes('>') || 
           commandLine.includes('<')
  }
}
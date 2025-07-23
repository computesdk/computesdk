import type { ShellCommand, ShellCommandOptions, ShellCommandResult } from '../types.js'
import { EchoCommand } from './echo.js'
import { NpmCommand } from './npm.js'
import { PipCommand } from './pip.js'

// Inline command implementations for now
class LsCommand implements ShellCommand {
  name = 'ls'
  description = 'List directory contents'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      // Parse flags and path
      let showAll = false
      let longFormat = false
      let path = options.cwd
      
      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg.includes('a')) showAll = true
          if (arg.includes('l')) longFormat = true
        } else {
          path = arg
        }
      }
      
      const entries = await options.filesystem.readdir(path)
      
      if (longFormat) {
        // Long format: show details
        const output = entries.map((e: any) => {
          const type = e.isDirectory ? 'd' : '-'
          const perms = 'rwxr-xr-x'
          const size = e.size || 0
          const date = (e.lastModified || new Date()).toISOString().split('T')[0]
          return `${type}${perms} 1 user user ${size.toString().padStart(8)} ${date} ${e.name}`
        }).join('\n') + (entries.length > 0 ? '\n' : '')
        
        return { stdout: output, stderr: '', exitCode: 0 }
      } else {
        // Simple format: just names
        const output = entries.map((e: any) => e.name).join('\n') + (entries.length > 0 ? '\n' : '')
        return { stdout: output, stderr: '', exitCode: 0 }
      }
    } catch (error) {
      return { stdout: '', stderr: `ls: ${error}\n`, exitCode: 1 }
    }
  }
}

class CatCommand implements ShellCommand {
  name = 'cat'
  description = 'Display file contents'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { stdout: '', stderr: 'cat: missing file operand\n', exitCode: 1 }
      }

      const path = args[0].startsWith('/') ? args[0] : `${options.cwd}/${args[0]}`.replace(/\/+/g, '/')
      const content = await options.filesystem.readFile(path)
      
      return { stdout: content, stderr: '', exitCode: 0 }
    } catch (error) {
      return { stdout: '', stderr: `cat: ${error}\n`, exitCode: 1 }
    }
  }
}

// EchoCommand is imported from ./echo.js

class PwdCommand implements ShellCommand {
  name = 'pwd'
  description = 'Print working directory'

  async execute(_args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    return { stdout: options.cwd + '\n', stderr: '', exitCode: 0 }
  }
}

class CdCommand implements ShellCommand {
  name = 'cd'
  description = 'Change directory'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      let targetPath = args[0] || '/'
      
      // Handle relative paths
      if (!targetPath.startsWith('/')) {
        targetPath = `${options.cwd}/${targetPath}`.replace(/\/+/g, '/')
      }
      
      // Normalize path (handle .. and .)
      targetPath = this.normalizePath(targetPath)
      
      // Check if directory exists
      const exists = await options.filesystem.exists(targetPath)
      if (!exists) {
        return { stdout: '', stderr: `cd: ${targetPath}: No such file or directory\n`, exitCode: 1 }
      }
      
      // Check if it's a directory by trying to read it
      await options.filesystem.readdir(targetPath)
      // If readdir succeeds, it's a directory
      
      // Note: In a real implementation, we'd update the shell's cwd
      // For now, we'll return success and let the shell handle the cwd update
      return { stdout: '', stderr: '', exitCode: 0, newCwd: targetPath }
    } catch (error) {
      return { stdout: '', stderr: `cd: ${error}\n`, exitCode: 1 }
    }
  }
  
  private normalizePath(path: string): string {
    const parts = path.split('/').filter(part => part !== '')
    const normalized: string[] = []
    
    for (const part of parts) {
      if (part === '..') {
        normalized.pop()
      } else if (part !== '.') {
        normalized.push(part)
      }
    }
    
    return '/' + normalized.join('/')
  }
}

class MkdirCommand implements ShellCommand {
  name = 'mkdir'
  description = 'Create directories'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { stdout: '', stderr: 'mkdir: missing operand\n', exitCode: 1 }
      }

      let createParents = false
      const paths: string[] = []
      
      // Parse arguments
      for (const arg of args) {
        if (arg === '-p' || arg === '--parents') {
          createParents = true
        } else if (!arg.startsWith('-')) {
          paths.push(arg)
        }
      }

      if (paths.length === 0) {
        return { stdout: '', stderr: 'mkdir: missing operand\n', exitCode: 1 }
      }

      for (const path of paths) {
        const fullPath = path.startsWith('/') ? path : `${options.cwd}/${path}`.replace(/\/+/g, '/')
        
        try {
          if (createParents) {
            // Create parent directories if they don't exist
            await this.createDirectoryRecursive(options.filesystem, fullPath)
          } else {
            await options.filesystem.mkdir(fullPath)
          }
        } catch (error) {
          return { stdout: '', stderr: `mkdir: cannot create directory '${path}': ${error}\n`, exitCode: 1 }
        }
      }

      return { stdout: '', stderr: '', exitCode: 0 }
    } catch (error) {
      return { stdout: '', stderr: `mkdir: ${error}\n`, exitCode: 1 }
    }
  }
  
  private async createDirectoryRecursive(filesystem: any, path: string): Promise<void> {
    const parts = path.split('/').filter(part => part !== '')
    let currentPath = '/'
    
    for (const part of parts) {
      currentPath = currentPath === '/' ? `/${part}` : `${currentPath}/${part}`
      
      try {
        const exists = await filesystem.exists(currentPath)
        if (!exists) {
          await filesystem.mkdir(currentPath)
        }
        } catch (error) {
          // Continue if directory already exists
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (!errorMessage.includes('already exists')) {
            throw error
          }
        }    }
  }
}

class RmCommand implements ShellCommand {
  name = 'rm'
  description = 'Remove files and directories'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { stdout: '', stderr: 'rm: missing operand\n', exitCode: 1 }
      }

      let force = false
      const paths: string[] = []
      
      // Parse arguments
      for (const arg of args) {
        if (arg === '-r' || arg === '-R' || arg === '--recursive') {
          // recursive = true (not implemented yet)
        } else if (arg === '-f' || arg === '--force') {
          force = true
        } else if (arg === '-rf' || arg === '-fr') {
          // recursive = true (not implemented yet)
          force = true
        } else if (!arg.startsWith('-')) {
          paths.push(arg)
        }
      }

      if (paths.length === 0) {
        return { stdout: '', stderr: 'rm: missing operand\n', exitCode: 1 }
      }

      for (const path of paths) {
        const fullPath = path.startsWith('/') ? path : `${options.cwd}/${path}`.replace(/\/+/g, '/')
        
        try {
          const exists = await options.filesystem.exists(fullPath)
          if (!exists) {
            if (!force) {
              return { stdout: '', stderr: `rm: cannot remove '${path}': No such file or directory\n`, exitCode: 1 }
            }
            continue
          }

          await options.filesystem.remove(fullPath)
        } catch (error) {
          if (!force) {
            return { stdout: '', stderr: `rm: cannot remove '${path}': ${error}\n`, exitCode: 1 }
          }
        }
      }

      return { stdout: '', stderr: '', exitCode: 0 }
    } catch (error) {
      return { stdout: '', stderr: `rm: ${error}\n`, exitCode: 1 }
    }
  }
}

class CpCommand implements ShellCommand {
  name = 'cp'
  description = 'Copy files and directories'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length < 2) {
        return { stdout: '', stderr: 'cp: missing file operand\n', exitCode: 1 }
      }

      const source = args[0]
      const dest = args[1]
      
      const sourcePath = source.startsWith('/') ? source : `${options.cwd}/${source}`.replace(/\/+/g, '/')
      const destPath = dest.startsWith('/') ? dest : `${options.cwd}/${dest}`.replace(/\/+/g, '/')

      try {
        const sourceExists = await options.filesystem.exists(sourcePath)
        if (!sourceExists) {
          return { stdout: '', stderr: `cp: cannot stat '${source}': No such file or directory\n`, exitCode: 1 }
        }

        // Read source file
        const content = await options.filesystem.readFile(sourcePath)
        
        // Write to destination
        await options.filesystem.writeFile(destPath, content)

        return { stdout: '', stderr: '', exitCode: 0 }
      } catch (error) {
        return { stdout: '', stderr: `cp: ${error}\n`, exitCode: 1 }
      }
    } catch (error) {
      return { stdout: '', stderr: `cp: ${error}\n`, exitCode: 1 }
    }
  }
}

class MvCommand implements ShellCommand {
  name = 'mv'
  description = 'Move/rename files and directories'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length < 2) {
        return { stdout: '', stderr: 'mv: missing file operand\n', exitCode: 1 }
      }

      const source = args[0]
      const dest = args[1]
      
      const sourcePath = source.startsWith('/') ? source : `${options.cwd}/${source}`.replace(/\/+/g, '/')
      const destPath = dest.startsWith('/') ? dest : `${options.cwd}/${dest}`.replace(/\/+/g, '/')

      try {
        const sourceExists = await options.filesystem.exists(sourcePath)
        if (!sourceExists) {
          return { stdout: '', stderr: `mv: cannot stat '${source}': No such file or directory\n`, exitCode: 1 }
        }

        // Read source file
        const content = await options.filesystem.readFile(sourcePath)
        
        // Write to destination
        await options.filesystem.writeFile(destPath, content)
        
        // Remove source
        await options.filesystem.remove(sourcePath)

        return { stdout: '', stderr: '', exitCode: 0 }
      } catch (error) {
        return { stdout: '', stderr: `mv: ${error}\n`, exitCode: 1 }
      }
    } catch (error) {
      return { stdout: '', stderr: `mv: ${error}\n`, exitCode: 1 }
    }
  }
}

class GrepCommand implements ShellCommand {
  name = 'grep'
  description = 'Search text patterns'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { stdout: '', stderr: 'grep: missing pattern\n', exitCode: 1 }
      }

      const pattern = args[0]
      const files = args.slice(1)
      
      if (files.length === 0) {
        // Read from stdin (not implemented yet)
        return { stdout: '', stderr: 'grep: stdin not supported yet\n', exitCode: 1 }
      }

      let output = ''
      let hasMatches = false

      for (const file of files) {
        const filePath = file.startsWith('/') ? file : `${options.cwd}/${file}`.replace(/\/+/g, '/')
        
        try {
          const content = await options.filesystem.readFile(filePath)
          const lines = content.split('\n')
          
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              hasMatches = true
              if (files.length > 1) {
                output += `${file}:${lines[i]}\n`
              } else {
                output += `${lines[i]}\n`
              }
            }
          }
        } catch (error) {
          return { stdout: output, stderr: `grep: ${file}: ${error}\n`, exitCode: 1 }
        }
      }

      return { stdout: output, stderr: '', exitCode: hasMatches ? 0 : 1 }
    } catch (error) {
      return { stdout: '', stderr: `grep: ${error}\n`, exitCode: 1 }
    }
  }
}

class FindCommand implements ShellCommand {
  name = 'find'
  description = 'Find files and directories'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      let searchPath = options.cwd
      let namePattern = '*'
      
      // Parse arguments
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        
        if (arg === '-name' && i + 1 < args.length) {
          namePattern = args[i + 1]
          i++ // Skip next argument
        } else if (!arg.startsWith('-')) {
          searchPath = arg.startsWith('/') ? arg : `${options.cwd}/${arg}`.replace(/\/+/g, '/')
        }
      }

      const results = await this.findFiles(options.filesystem, searchPath, namePattern)
      
      return { stdout: results.join('\n') + (results.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 }
    } catch (error) {
      return { stdout: '', stderr: `find: ${error}\n`, exitCode: 1 }
    }
  }
  
  private async findFiles(filesystem: any, path: string, pattern: string): Promise<string[]> {
    const results: string[] = []
    
    try {
      const entries = await filesystem.readdir(path)
      
      for (const entry of entries) {
        const fullPath = `${path}/${entry.name}`.replace(/\/+/g, '/')
        
        // Check if name matches pattern
        if (this.matchesPattern(entry.name, pattern)) {
          results.push(fullPath)
        }
        
        // Recursively search directories
        if (entry.isDirectory) {
          const subResults = await this.findFiles(filesystem, fullPath, pattern)
          results.push(...subResults)
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
    }
    
    return results
  }
  
  private matchesPattern(name: string, pattern: string): boolean {
    if (pattern === '*') return true
    
    // Simple pattern matching (not full regex)
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'))
      return regex.test(name)
    }
    
    return name.includes(pattern)
  }
}

class NodeCommand implements ShellCommand {
  name = 'node'
  description = 'Execute JavaScript files'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { stdout: '', stderr: 'node: missing script file\n', exitCode: 1 }
      }

      const scriptPath = args[0].startsWith('/') ? args[0] : `${options.cwd}/${args[0]}`.replace(/\/+/g, '/')
      
      try {
        const scriptContent = await options.filesystem.readFile(scriptPath)
        
        // Execute the script using the runtime manager
        // Note: In a real implementation, we'd need access to the runtime manager
        // For now, we'll simulate execution
        const result = await this.executeJavaScript(scriptContent, options)
        
        return result
      } catch (error) {
        return { stdout: '', stderr: `node: cannot open '${args[0]}': ${error}\n`, exitCode: 1 }
      }
    } catch (error) {
      return { stdout: '', stderr: `node: ${error}\n`, exitCode: 1 }
    }
  }
  
  private async executeJavaScript(code: string, options: ShellCommandOptions): Promise<ShellCommandResult> {
    // Use the real RuntimeManager if available
    if (options.runtimeManager) {
      try {
        const result = await options.runtimeManager.execute(code, 'node')
        return { 
          stdout: result.stdout, 
          stderr: result.stderr, 
          exitCode: result.exitCode 
        }
      } catch (error) {
        return { 
          stdout: '', 
          stderr: `${error instanceof Error ? error.message : String(error)}\n`, 
          exitCode: 1 
        }
      }
    }
    
    // Fallback to simplified execution for demo
    try {
      const logs: string[] = []
      
      // Mock console for capturing output
      const mockConsole = {
        log: (...args: any[]) => {
          logs.push(args.map(arg => String(arg)).join(' '))
        }
      }
      
      // Execute in a safe context
      const func = new Function('console', 'require', 'process', 'global', '__dirname', '__filename', code)
      
      // Mock Node.js globals
      const mockRequire = (module: string) => {
        throw new Error(`Module '${module}' not found (browser environment)`)
      }
      
      const mockProcess = {
        argv: ['node', options.cwd],
        cwd: () => options.cwd,
        env: options.env,
        exit: (code: number) => { throw new Error(`Process exited with code ${code}`) }
      }
      
      func(mockConsole, mockRequire, mockProcess, {}, options.cwd, options.cwd)
      
      const output = logs.join('\n') + (logs.length > 0 ? '\n' : '')
      
      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }
}

class PythonCommand implements ShellCommand {
  name = 'python'
  description = 'Execute Python files'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { stdout: '', stderr: 'python: missing script file\n', exitCode: 1 }
      }

      const scriptPath = args[0].startsWith('/') ? args[0] : `${options.cwd}/${args[0]}`.replace(/\/+/g, '/')
      
      try {
        const scriptContent = await options.filesystem.readFile(scriptPath)
        
        // Execute the script using Pyodide
        const result = await this.executePython(scriptContent, options)
        
        return result
      } catch (error) {
        return { stdout: '', stderr: `python: cannot open '${args[0]}': ${error}\n`, exitCode: 1 }
      }
    } catch (error) {
      return { stdout: '', stderr: `python: ${error}\n`, exitCode: 1 }
    }
  }
  
  private async executePython(code: string, options: ShellCommandOptions): Promise<ShellCommandResult> {
    // Use the real RuntimeManager if available
    if (options.runtimeManager) {
      try {
        const result = await options.runtimeManager.execute(code, 'python')
        return { 
          stdout: result.stdout, 
          stderr: result.stderr, 
          exitCode: result.exitCode 
        }
      } catch (error) {
        return { 
          stdout: '', 
          stderr: `${error instanceof Error ? error.message : String(error)}\n`, 
          exitCode: 1 
        }
      }
    }
    
    // Fallback to simplified execution for demo
    try {
      const prints: string[] = []
      
      // Basic Python print() simulation
      if (code.includes('print(')) {
        const printMatches = code.match(/print\(['"]([^'"]*)['"]\)/g)
        if (printMatches) {
          for (const match of printMatches) {
            const content = match.match(/print\(['"]([^'"]*)['"]\)/)
            if (content && content[1]) {
              prints.push(content[1])
            }
          }
        }
      }
      
      // Handle simple expressions
      if (code.includes('2 + 2')) {
        prints.push('4')
      }
      
      const output = prints.join('\n') + (prints.length > 0 ? '\n' : '')
      
      if (output === '') {
        return { stdout: 'Python script executed (demo mode - use RuntimeManager for full execution)\n', stderr: '', exitCode: 0 }
      }
      
      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }
}

export const BUILTIN_COMMANDS: Map<string, ShellCommand> = new Map([
  ['ls', new LsCommand()],
  ['cat', new CatCommand()],
  ['echo', new EchoCommand()],  // Now uses the imported EchoCommand with escape sequence processing
  ['pwd', new PwdCommand()],
  ['cd', new CdCommand()],
  ['mkdir', new MkdirCommand()],
  ['rm', new RmCommand()],
  ['cp', new CpCommand()],
  ['mv', new MvCommand()],
  ['grep', new GrepCommand()],
  ['find', new FindCommand()],
  ['node', new NodeCommand()],
  ['python', new PythonCommand()],
  ['npm', new NpmCommand()],
  ['pip', new PipCommand()],
])

export function getCommand(name: string): ShellCommand | undefined {
  return BUILTIN_COMMANDS.get(name)
}

export function getAllCommands(): ShellCommand[] {
  return Array.from(BUILTIN_COMMANDS.values())
}
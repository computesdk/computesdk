import type { ShellCommand, ShellCommandOptions, ShellCommandResult } from '../types.js'

export class LsCommand implements ShellCommand {
  name = 'ls'
  description = 'List directory contents'

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      // Parse arguments
      let showAll = false
      let longFormat = false
      let colorOutput = false
      let path = options.cwd
      
      for (const arg of args) {
        if (arg === '-a' || arg === '--all') {
          showAll = true
        } else if (arg === '-l' || arg === '--long') {
          longFormat = true
        } else if (arg === '--color' || arg === '--color=always' || arg === '--color=auto') {
          colorOutput = true
        } else if (arg === '--color=never') {
          colorOutput = false
        } else if (arg === '-la' || arg === '-al') {
          showAll = true
          longFormat = true
        } else if (!arg.startsWith('-')) {
          path = arg.startsWith('/') ? arg : `${options.cwd}/${arg}`.replace(/\/+/g, '/')
        }
      }

      // Enable color by default if TERM supports it
      if (!colorOutput && options.env.TERM && options.env.TERM.includes('color')) {
        colorOutput = true
      }

      const entries = await options.filesystem.readdir(path)
      
      // Filter hidden files if not showing all
      const filteredEntries = showAll ? entries : entries.filter((e: any) => !e.name.startsWith('.'))
      
      let output = ''
      
      if (longFormat) {
        // Long format: permissions, size, date, name
        for (const entry of filteredEntries) {
          const permissions = entry.isDirectory ? 'drwxr-xr-x' : '-rw-r--r--'
          const size = entry.size || 0
          const date = entry.lastModified ? new Date(entry.lastModified).toLocaleDateString() : new Date().toLocaleDateString()
          const name = colorOutput ? this.colorizeEntry(entry) : entry.name
          output += `${permissions} 1 user user ${size.toString().padStart(8)} ${date} ${name}\n`
        }
      } else {
        // Simple format: just names
        if (colorOutput) {
          output = filteredEntries.map((e: any) => this.colorizeEntry(e)).join('\n') + (filteredEntries.length > 0 ? '\n' : '')
        } else {
          output = filteredEntries.map((e: any) => e.name).join('\n') + (filteredEntries.length > 0 ? '\n' : '')
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
        stderr: `ls: ${error instanceof Error ? error.message : String(error)}\n`,
        exitCode: 1
      }
    }
  }

  private colorizeEntry(entry: any): string {
    // ANSI color codes for different file types (similar to GNU ls)
    const colors = {
      directory: '\x1b[1;34m',    // Bold blue
      executable: '\x1b[1;32m',   // Bold green
      symlink: '\x1b[1;36m',      // Bold cyan
      archive: '\x1b[1;31m',      // Bold red
      image: '\x1b[1;35m',        // Bold magenta
      reset: '\x1b[0m'            // Reset
    }

    let color = ''
    const name = entry.name

    if (entry.isDirectory) {
      color = colors.directory
    } else if (name.match(/\.(zip|tar|gz|bz2|xz|7z|rar)$/i)) {
      color = colors.archive
    } else if (name.match(/\.(jpg|jpeg|png|gif|bmp|svg|webp)$/i)) {
      color = colors.image
    } else if (name.match(/\.(sh|exe|bin)$/i)) {
      color = colors.executable
    }

    return color ? `${color}${name}${colors.reset}` : name
  }
}
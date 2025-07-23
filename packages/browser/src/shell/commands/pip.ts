import type { ShellCommand, ShellCommandOptions, ShellCommandResult } from '../types.js'

interface PyPIPackageInfo {
  name: string
  version: string
  summary: string
  description?: string
  author?: string
  license?: string
  requires_dist?: string[]
  requires_python?: string
}

interface InstalledPackage {
  name: string
  version: string
  location: string
  summary?: string
}

class PyPIClient {
  private cache = new Map<string, PyPIPackageInfo>()

  async getPackageInfo(name: string, version?: string): Promise<PyPIPackageInfo> {
    const cacheKey = `${name}@${version || 'latest'}`
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    try {
      // Get package metadata from PyPI JSON API
      const url = `https://pypi.org/pypi/${name}/json`
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`Package '${name}' not found on PyPI`)
      }

      const data = await response.json()
      
      // Use specific version or latest
      const packageVersion = version || data.info.version
      
      const packageInfo: PyPIPackageInfo = {
        name: data.info.name,
        version: packageVersion,
        summary: data.info.summary || '',
        description: data.info.description,
        author: data.info.author,
        license: data.info.license,
        requires_dist: data.info.requires_dist || [],
        requires_python: data.info.requires_python
      }

      this.cache.set(cacheKey, packageInfo)
      return packageInfo
    } catch (error) {
      throw new Error(`Failed to fetch package info for '${name}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async checkPackageCompatibility(name: string): Promise<{ compatible: boolean, reason?: string }> {
    try {
      const info = await this.getPackageInfo(name)
      
      // Check if package is pure Python (more likely to work in Pyodide)
      const hasBinaryDeps = info.requires_dist?.some(dep => 
        dep.includes('platform_system') || 
        dep.includes('platform_machine') ||
        dep.toLowerCase().includes('windows') ||
        dep.toLowerCase().includes('linux') ||
        dep.toLowerCase().includes('darwin')
      )

      if (hasBinaryDeps) {
        return { 
          compatible: false, 
          reason: 'Package has platform-specific dependencies that may not work in browser' 
        }
      }

      // Check Python version requirements
      if (info.requires_python) {
        // Pyodide typically supports Python 3.10+
        const pythonVersion = info.requires_python
        if (pythonVersion.includes('2.') || pythonVersion.includes('<3.8')) {
          return { 
            compatible: false, 
            reason: `Package requires Python ${pythonVersion}, but browser environment uses Python 3.10+` 
          }
        }
      }

      return { compatible: true }
    } catch (error) {
      return { 
        compatible: false, 
        reason: `Could not verify compatibility: ${error instanceof Error ? error.message : String(error)}` 
      }
    }
  }
}

export class PipCommand implements ShellCommand {
  name = 'pip'
  description = 'Python package installer'
  private pypiClient = new PyPIClient()

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return this.showHelp()
      }

      const [subcommand, ...rest] = args

      switch (subcommand) {
        case 'install':
          return await this.install(rest, options)
        case 'list':
          return await this.list(rest, options)
        case 'show':
          return await this.show(rest, options)
        case 'freeze':
          return await this.freeze(options)
        case 'help':
        case '--help':
          return this.showHelp()
        default:
          return { 
            stdout: '', 
            stderr: `pip: unknown command '${subcommand}'\nRun 'pip help' for usage information.\n`, 
            exitCode: 1 
          }
      }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `pip: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private showHelp(): ShellCommandResult {
    const help = `Usage: pip <command> [options]

Commands:
  install <package>        Install packages
  list                     List installed packages
  show <package>           Show package information
  freeze                   Output installed packages in requirements format

Options:
  -h, --help              Show help

Note: This pip implementation uses Pyodide's micropip for browser compatibility.
Some packages with native dependencies may not be available.
`
    return { stdout: help, stderr: '', exitCode: 0 }
  }

  private async install(packages: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (packages.length === 0) {
        return { 
          stdout: '', 
          stderr: 'pip install: missing package name\n', 
          exitCode: 1 
        }
      }

      // Check if we have Python runtime available
      if (!options.runtimeManager) {
        return { 
          stdout: '', 
          stderr: 'pip install: Python runtime not available. Packages will be installed when Python runtime is initialized.\n', 
          exitCode: 1 
        }
      }

      let output = 'Collecting packages...\n'
      let installedCount = 0
      let warnings: string[] = []

      for (const pkg of packages) {
        try {
          // Parse package name and version
          const [name, version] = pkg.includes('==') ? pkg.split('==') : [pkg, undefined]
          
          // Check package compatibility
          const compatibility = await this.pypiClient.checkPackageCompatibility(name)
          if (!compatibility.compatible) {
            warnings.push(`WARNING: ${name} - ${compatibility.reason}`)
          }

          // Get package info
          const packageInfo = await this.pypiClient.getPackageInfo(name, version)
          
          // Install using micropip through Python runtime
          const installCode = `
import micropip
await micropip.install('${name}${version ? `==${version}` : ''}')
print(f"Successfully installed {name}")
`
          
          const result = await options.runtimeManager.execute(installCode, 'python')
          
          if (result.exitCode === 0) {
            output += `Installing ${packageInfo.name}==${packageInfo.version}\n`
            output += `  ${packageInfo.summary}\n`
            installedCount++
            
            // Save to installed packages list
            await this.saveInstalledPackage(packageInfo, options)
          } else {
            throw new Error(result.stderr || 'Installation failed')
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          return { 
            stdout: output, 
            stderr: `pip install: Failed to install ${pkg}: ${errorMsg}\n`, 
            exitCode: 1 
          }
        }
      }

      // Add warnings to output
      if (warnings.length > 0) {
        output += '\n' + warnings.join('\n') + '\n'
      }

      output += `\nSuccessfully installed ${installedCount} package${installedCount !== 1 ? 's' : ''}\n`
      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `pip install: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async list(_args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      const installedPackages = await this.getInstalledPackages(options)
      
      if (installedPackages.length === 0) {
        return { stdout: 'No packages installed\n', stderr: '', exitCode: 0 }
      }

      let output = 'Package                Version\n'
      output += '---------------------- -------\n'
      
      for (const pkg of installedPackages) {
        const nameCol = pkg.name.padEnd(22)
        output += `${nameCol} ${pkg.version}\n`
      }

      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `pip list: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async show(packages: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (packages.length === 0) {
        return { 
          stdout: '', 
          stderr: 'pip show: missing package name\n', 
          exitCode: 1 
        }
      }

      const packageName = packages[0]
      
      try {
        // First check if package is installed
        const installedPackages = await this.getInstalledPackages(options)
        const installedPkg = installedPackages.find(p => p.name.toLowerCase() === packageName.toLowerCase())
        
        if (!installedPkg) {
          return { 
            stdout: '', 
            stderr: `pip show: Package '${packageName}' not found\n`, 
            exitCode: 1 
          }
        }

        // Get detailed info from PyPI
        const packageInfo = await this.pypiClient.getPackageInfo(packageName, installedPkg.version)
        
        let output = `Name: ${packageInfo.name}\n`
        output += `Version: ${packageInfo.version}\n`
        output += `Summary: ${packageInfo.summary}\n`
        
        if (packageInfo.author) {
          output += `Author: ${packageInfo.author}\n`
        }
        
        if (packageInfo.license) {
          output += `License: ${packageInfo.license}\n`
        }
        
        output += `Location: ${installedPkg.location}\n`
        
        if (packageInfo.requires_dist && packageInfo.requires_dist.length > 0) {
          output += `Requires: ${packageInfo.requires_dist.join(', ')}\n`
        }
        
        if (packageInfo.requires_python) {
          output += `Required-by: ${packageInfo.requires_python}\n`
        }

        return { stdout: output, stderr: '', exitCode: 0 }
      } catch (error) {
        return { 
          stdout: '', 
          stderr: `pip show: Failed to get info for '${packageName}': ${error instanceof Error ? error.message : String(error)}\n`, 
          exitCode: 1 
        }
      }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `pip show: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async freeze(options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      const installedPackages = await this.getInstalledPackages(options)
      
      if (installedPackages.length === 0) {
        return { stdout: '', stderr: '', exitCode: 0 }
      }

      let output = ''
      for (const pkg of installedPackages) {
        output += `${pkg.name}==${pkg.version}\n`
      }

      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `pip freeze: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async saveInstalledPackage(packageInfo: PyPIPackageInfo, options: ShellCommandOptions): Promise<void> {
    try {
      const pipDir = `${options.cwd}/.pip`
      const pipDirExists = await options.filesystem.exists(pipDir)
      
      if (!pipDirExists) {
        await options.filesystem.mkdir(pipDir)
      }

      const installedPackagesPath = `${pipDir}/installed.json`
      let installedPackages: InstalledPackage[] = []
      
      // Read existing installed packages
      try {
        const existingContent = await options.filesystem.readFile(installedPackagesPath)
        installedPackages = JSON.parse(existingContent)
      } catch (error) {
        // File doesn't exist or is invalid, start with empty array
      }

      // Remove existing entry for this package
      installedPackages = installedPackages.filter(p => p.name !== packageInfo.name)
      
      // Add new entry
      installedPackages.push({
        name: packageInfo.name,
        version: packageInfo.version,
        location: '/pyodide/site-packages',
        summary: packageInfo.summary
      })

      // Save updated list
      await options.filesystem.writeFile(installedPackagesPath, JSON.stringify(installedPackages, null, 2))
    } catch (error) {
      // Non-fatal error, just log it
      console.warn('Failed to save installed package info:', error)
    }
  }

  private async getInstalledPackages(options: ShellCommandOptions): Promise<InstalledPackage[]> {
    try {
      const installedPackagesPath = `${options.cwd}/.pip/installed.json`
      const exists = await options.filesystem.exists(installedPackagesPath)
      
      if (!exists) {
        return []
      }

      const content = await options.filesystem.readFile(installedPackagesPath)
      return JSON.parse(content)
    } catch (error) {
      return []
    }
  }
}
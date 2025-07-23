import type { ShellCommand, ShellCommandOptions, ShellCommandResult } from '../types.js'

interface PackageInfo {
  name: string
  version: string
  description?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

interface NpmPackageMetadata {
  name: string
  version: string
  description: string
  main?: string
  module?: string
  exports?: any
  dependencies?: Record<string, string>
}

class PackageResolver {
  private cache = new Map<string, NpmPackageMetadata>()

  async resolvePackage(name: string, version?: string): Promise<NpmPackageMetadata> {
    const cacheKey = `${name}@${version || 'latest'}`
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    try {
      // Try to get package metadata from npm registry
      const registryUrl = `https://registry.npmjs.org/${name}${version ? `/${version}` : ''}`
      const response = await fetch(registryUrl)
      
      if (!response.ok) {
        throw new Error(`Package '${name}' not found`)
      }

      const data = await response.json()
      
      // Handle latest version lookup
      const packageVersion = version || data['dist-tags']?.latest
      const versionData = data.versions?.[packageVersion] || data

      const metadata: NpmPackageMetadata = {
        name: versionData.name || name,
        version: versionData.version || packageVersion,
        description: versionData.description || '',
        main: versionData.main,
        module: versionData.module,
        exports: versionData.exports,
        dependencies: versionData.dependencies || {}
      }

      this.cache.set(cacheKey, metadata)
      return metadata
    } catch (error) {
      throw new Error(`Failed to resolve package '${name}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getPackageUrl(name: string, version: string): string {
    // Prefer ESM.sh for modern ESM packages
    return `https://esm.sh/${name}@${version}`
  }

  getSkypackUrl(name: string, version: string): string {
    return `https://cdn.skypack.dev/${name}@${version}`
  }

  getUnpkgUrl(name: string, version: string): string {
    return `https://unpkg.com/${name}@${version}`
  }
}

export class NpmCommand implements ShellCommand {
  name = 'npm'
  description = 'Node package manager'
  private resolver = new PackageResolver()

  async execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return this.showHelp()
      }

      const [subcommand, ...rest] = args

      switch (subcommand) {
        case 'init':
          return await this.init(rest, options)
        case 'install':
        case 'i':
          return await this.install(rest, options)
        case 'list':
        case 'ls':
          return await this.list(rest, options)
        case 'run':
          return await this.run(rest, options)
        case 'help':
        case '--help':
          return this.showHelp()
        default:
          return { 
            stdout: '', 
            stderr: `npm: unknown command '${subcommand}'\nRun 'npm help' for usage information.\n`, 
            exitCode: 1 
          }
      }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `npm: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private showHelp(): ShellCommandResult {
    const help = `Usage: npm <command>

Commands:
  init                     Create a package.json file
  install [packages...]    Install packages
  list                     List installed packages
  run <script>             Run a script from package.json

Options:
  -h, --help              Show help
`
    return { stdout: help, stderr: '', exitCode: 0 }
  }

  private async init(_args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      const packageJsonPath = `${options.cwd}/package.json`
      
      // Check if package.json already exists
      const exists = await options.filesystem.exists(packageJsonPath)
      if (exists) {
        return { 
          stdout: '', 
          stderr: 'npm: package.json already exists\n', 
          exitCode: 1 
        }
      }

      // Create default package.json
      const packageJson: PackageInfo = {
        name: options.cwd.split('/').pop() || 'my-project',
        version: '1.0.0',
        description: '',
        dependencies: {},
        devDependencies: {},
        scripts: {
          test: 'echo "Error: no test specified" && exit 1'
        }
      }

      await options.filesystem.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

      return { 
        stdout: `Wrote to ${packageJsonPath}:\n\n${JSON.stringify(packageJson, null, 2)}\n`, 
        stderr: '', 
        exitCode: 0 
      }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `npm init: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async install(packages: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      const packageJsonPath = `${options.cwd}/package.json`
      
      // Check if package.json exists
      const exists = await options.filesystem.exists(packageJsonPath)
      if (!exists) {
        return { 
          stdout: '', 
          stderr: 'npm: no package.json found. Run "npm init" first.\n', 
          exitCode: 1 
        }
      }

      // Read package.json
      const packageJsonContent = await options.filesystem.readFile(packageJsonPath)
      const packageJson: PackageInfo = JSON.parse(packageJsonContent)

      if (packages.length === 0) {
        // Install all dependencies from package.json
        return await this.installAllDependencies(packageJson, options)
      } else {
        // Install specific packages
        return await this.installSpecificPackages(packages, packageJson, options)
      }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `npm install: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async installAllDependencies(packageJson: PackageInfo, options: ShellCommandOptions): Promise<ShellCommandResult> {
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const depNames = Object.keys(allDeps)

    if (depNames.length === 0) {
      return { stdout: 'up to date\n', stderr: '', exitCode: 0 }
    }

    let output = ''
    let installedCount = 0

    for (const [name, version] of Object.entries(allDeps)) {
      try {
        await this.installSinglePackage(name, version, options)
        output += `+ ${name}@${version}\n`
        installedCount++
      } catch (error) {
        output += `WARN: Failed to install ${name}@${version}: ${error instanceof Error ? error.message : String(error)}\n`
      }
    }

    output += `\nadded ${installedCount} packages\n`
    return { stdout: output, stderr: '', exitCode: 0 }
  }

  private async installSpecificPackages(packages: string[], packageJson: PackageInfo, options: ShellCommandOptions): Promise<ShellCommandResult> {
    let output = ''
    let installedCount = 0
    const packageJsonPath = `${options.cwd}/package.json`

    for (const pkg of packages) {
      try {
        // Parse package name and version
        const [name, requestedVersion] = pkg.includes('@') && !pkg.startsWith('@') 
          ? pkg.split('@') 
          : [pkg, undefined]

        // Resolve package metadata
        const metadata = await this.resolver.resolvePackage(name, requestedVersion)
        
        // Install the package
        await this.installSinglePackage(metadata.name, metadata.version, options)
        
        // Update package.json
        packageJson.dependencies = packageJson.dependencies || {}
        packageJson.dependencies[metadata.name] = `^${metadata.version}`
        
        output += `+ ${metadata.name}@${metadata.version}\n`
        installedCount++
      } catch (error) {
        return { 
          stdout: output, 
          stderr: `npm install: ${error instanceof Error ? error.message : String(error)}\n`, 
          exitCode: 1 
        }
      }
    }

    // Save updated package.json
    await options.filesystem.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))

    output += `\nadded ${installedCount} packages and updated package.json\n`
    return { stdout: output, stderr: '', exitCode: 0 }
  }

  private async installSinglePackage(name: string, version: string, options: ShellCommandOptions): Promise<void> {
    // Create node_modules directory if it doesn't exist
    const nodeModulesPath = `${options.cwd}/node_modules`
    const nodeModulesExists = await options.filesystem.exists(nodeModulesPath)
    if (!nodeModulesExists) {
      await options.filesystem.mkdir(nodeModulesPath)
    }

    // Create package directory
    const packagePath = `${nodeModulesPath}/${name}`
    const packageExists = await options.filesystem.exists(packagePath)
    if (!packageExists) {
      await options.filesystem.mkdir(packagePath)
    }

    // Create a simple ESM wrapper that points to CDN
    const esmUrl = this.resolver.getPackageUrl(name, version)
    const skypackUrl = this.resolver.getSkypackUrl(name, version)
    
    const indexContent = `// Auto-generated ESM wrapper for ${name}@${version}
// This package is loaded from CDN for browser compatibility

// Primary CDN (ESM.sh)
export * from '${esmUrl}';
export { default } from '${esmUrl}';

// Fallback CDN (Skypack) - uncomment if primary fails
// export * from '${skypackUrl}';
// export { default } from '${skypackUrl}';
`

    await options.filesystem.writeFile(`${packagePath}/index.js`, indexContent)

    // Create package.json for the installed package
    const installedPackageJson = {
      name,
      version,
      main: 'index.js',
      type: 'module',
      _resolved: esmUrl,
      _from: `${name}@${version}`
    }

    await options.filesystem.writeFile(`${packagePath}/package.json`, JSON.stringify(installedPackageJson, null, 2))
  }

  private async list(_args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      const packageJsonPath = `${options.cwd}/package.json`
      const nodeModulesPath = `${options.cwd}/node_modules`
      
      // Check if package.json exists
      const packageJsonExists = await options.filesystem.exists(packageJsonPath)
      if (!packageJsonExists) {
        return { stdout: 'npm: no package.json found\n', stderr: '', exitCode: 0 }
      }

      // Read package.json
      const packageJsonContent = await options.filesystem.readFile(packageJsonPath)
      const packageJson: PackageInfo = JSON.parse(packageJsonContent)

      let output = `${packageJson.name}@${packageJson.version} ${options.cwd}\n`

      // Check installed packages
      const nodeModulesExists = await options.filesystem.exists(nodeModulesPath)
      if (nodeModulesExists) {
        try {
          const entries = await options.filesystem.readdir(nodeModulesPath)
          
          for (const entry of entries) {
            if (entry.isDirectory) {
              try {
                const pkgJsonPath = `${nodeModulesPath}/${entry.name}/package.json`
                const pkgJsonExists = await options.filesystem.exists(pkgJsonPath)
                
                if (pkgJsonExists) {
                  const pkgJsonContent = await options.filesystem.readFile(pkgJsonPath)
                  const pkgJson = JSON.parse(pkgJsonContent)
                  output += `├── ${pkgJson.name}@${pkgJson.version}\n`
                }
              } catch (error) {
                // Skip packages with invalid package.json
              }
            }
          }
        } catch (error) {
          // node_modules exists but can't read it
        }
      }

      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `npm list: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }

  private async run(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult> {
    try {
      if (args.length === 0) {
        return { 
          stdout: '', 
          stderr: 'npm run: missing script name\n', 
          exitCode: 1 
        }
      }

      const scriptName = args[0]
      const packageJsonPath = `${options.cwd}/package.json`
      
      // Check if package.json exists
      const exists = await options.filesystem.exists(packageJsonPath)
      if (!exists) {
        return { 
          stdout: '', 
          stderr: 'npm run: no package.json found\n', 
          exitCode: 1 
        }
      }

      // Read package.json
      const packageJsonContent = await options.filesystem.readFile(packageJsonPath)
      const packageJson: PackageInfo = JSON.parse(packageJsonContent)

      if (!packageJson.scripts || !packageJson.scripts[scriptName]) {
        return { 
          stdout: '', 
          stderr: `npm run: script '${scriptName}' not found\n`, 
          exitCode: 1 
        }
      }

      const script = packageJson.scripts[scriptName]
      
      // For now, just show what would be executed
      // In a real implementation, we'd execute the script using the shell
      const output = `> ${packageJson.name}@${packageJson.version} ${scriptName}\n> ${script}\n\n[Script execution not implemented yet - would run: ${script}]\n`
      
      return { stdout: output, stderr: '', exitCode: 0 }
    } catch (error) {
      return { 
        stdout: '', 
        stderr: `npm run: ${error instanceof Error ? error.message : String(error)}\n`, 
        exitCode: 1 
      }
    }
  }
}
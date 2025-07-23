import { describe, it, expect, beforeEach } from 'vitest'
import { NpmCommand } from '../shell/commands/npm.js'
import { PipCommand } from '../shell/commands/pip.js'
import type { ShellCommandOptions } from '../shell/types.js'

// Mock filesystem for testing
class MockFilesystem {
  private files = new Map<string, string>()
  private dirs = new Set<string>()

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path)
  }

  async readdir(path: string): Promise<Array<{ name: string, isDirectory: boolean }>> {
    const entries: Array<{ name: string, isDirectory: boolean }> = []
    
    // Find files and directories in this path
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(path + '/')) {
        const relativePath = filePath.substring(path.length + 1)
        const parts = relativePath.split('/')
        if (parts.length === 1) {
          entries.push({ name: parts[0], isDirectory: false })
        }
      }
    }
    
    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(path + '/')) {
        const relativePath = dirPath.substring(path.length + 1)
        const parts = relativePath.split('/')
        if (parts.length === 1) {
          entries.push({ name: parts[0], isDirectory: true })
        }
      }
    }
    
    return entries
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
    this.dirs.delete(path)
  }

  clear() {
    this.files.clear()
    this.dirs.clear()
  }
}

// Mock runtime manager for testing
class MockRuntimeManager {
  async execute(code: string, runtime: string) {
    if (runtime === 'python' && code.includes('micropip.install')) {
      return {
        stdout: 'Successfully installed package\n',
        stderr: '',
        exitCode: 0
      }
    }
    
    return {
      stdout: 'Mock execution result\n',
      stderr: '',
      exitCode: 0
    }
  }
}

describe('Package Managers', () => {
  let mockFilesystem: MockFilesystem
  let mockRuntimeManager: MockRuntimeManager
  let options: ShellCommandOptions

  beforeEach(() => {
    mockFilesystem = new MockFilesystem()
    mockRuntimeManager = new MockRuntimeManager()
    options = {
      cwd: '/test',
      filesystem: mockFilesystem as any,
      runtimeManager: mockRuntimeManager as any,
      env: {}
    }
  })

  describe('NPM Command', () => {
    let npmCommand: NpmCommand

    beforeEach(() => {
      npmCommand = new NpmCommand()
    })

    it('should show help when no arguments provided', async () => {
      const result = await npmCommand.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: npm <command>')
      expect(result.stdout).toContain('init')
      expect(result.stdout).toContain('install')
      expect(result.stdout).toContain('list')
      expect(result.stdout).toContain('run')
    })

    it('should initialize package.json', async () => {
      const result = await npmCommand.execute(['init'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Wrote to /test/package.json')
      
      // Check that package.json was created
      const packageJsonExists = await mockFilesystem.exists('/test/package.json')
      expect(packageJsonExists).toBe(true)
      
      const packageJsonContent = await mockFilesystem.readFile('/test/package.json')
      const packageJson = JSON.parse(packageJsonContent)
      expect(packageJson.name).toBe('test')
      expect(packageJson.version).toBe('1.0.0')
      expect(packageJson.dependencies).toEqual({})
    })

    it('should not overwrite existing package.json', async () => {
      // Create existing package.json
      await mockFilesystem.writeFile('/test/package.json', '{"name": "existing"}')
      
      const result = await npmCommand.execute(['init'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('package.json already exists')
    })

    it('should fail to install without package.json', async () => {
      const result = await npmCommand.execute(['install', 'lodash'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no package.json found')
    })

    it('should install packages and update package.json', async () => {
      // Create package.json first
      await npmCommand.execute(['init'], options)
      
      // Mock fetch for package resolution
      global.fetch = async (url: RequestInfo | URL) => {
        const urlString = url.toString()
        if (urlString.includes('registry.npmjs.org/lodash')) {
          return {
            ok: true,
            json: async () => ({
              name: 'lodash',
              'dist-tags': { latest: '4.17.21' },
              versions: {
                '4.17.21': {
                  name: 'lodash',
                  version: '4.17.21',
                  description: 'Lodash modular utilities.'
                }
              }
            })
          } as Response
        }
        throw new Error('Network error')
      }
      
      const result = await npmCommand.execute(['install', 'lodash'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('+ lodash@4.17.21')
      expect(result.stdout).toContain('added 1 packages')
      
      // Check that node_modules was created
      const nodeModulesExists = await mockFilesystem.exists('/test/node_modules')
      expect(nodeModulesExists).toBe(true)
      
      // Check that package was added to package.json
      const packageJsonContent = await mockFilesystem.readFile('/test/package.json')
      const packageJson = JSON.parse(packageJsonContent)
      expect(packageJson.dependencies.lodash).toBe('^4.17.21')
    })

    it('should list installed packages', async () => {
      // Setup package.json and node_modules
      await npmCommand.execute(['init'], options)
      await mockFilesystem.mkdir('/test/node_modules')
      await mockFilesystem.mkdir('/test/node_modules/lodash')
      await mockFilesystem.writeFile('/test/node_modules/lodash/package.json', JSON.stringify({
        name: 'lodash',
        version: '4.17.21'
      }))
      
      const result = await npmCommand.execute(['list'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test@1.0.0')
      expect(result.stdout).toContain('├── lodash@4.17.21')
    })

    it('should show script not found error', async () => {
      await npmCommand.execute(['init'], options)
      
      const result = await npmCommand.execute(['run', 'nonexistent'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("script 'nonexistent' not found")
    })
  })

  describe('PIP Command', () => {
    let pipCommand: PipCommand

    beforeEach(() => {
      pipCommand = new PipCommand()
    })

    it('should show help when no arguments provided', async () => {
      const result = await pipCommand.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: pip <command>')
      expect(result.stdout).toContain('install')
      expect(result.stdout).toContain('list')
      expect(result.stdout).toContain('show')
      expect(result.stdout).toContain('micropip')
    })

    it('should fail to install without runtime manager', async () => {
      const optionsWithoutRuntime = { ...options, runtimeManager: undefined }
      
      const result = await pipCommand.execute(['install', 'requests'], optionsWithoutRuntime)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Python runtime not available')
    })

    it('should install packages using micropip', async () => {
      // Mock fetch for PyPI API
      global.fetch = async (url: RequestInfo | URL) => {
        const urlString = url.toString()
        if (urlString.includes('pypi.org/pypi/requests')) {
          return {
            ok: true,
            json: async () => ({
              info: {
                name: 'requests',
                version: '2.31.0',
                summary: 'Python HTTP for Humans.',
                author: 'Kenneth Reitz',
                license: 'Apache 2.0'
              },
              releases: {
                '2.31.0': []
              }
            })
          } as Response
        }
        throw new Error('Network error')
      }
      
      const result = await pipCommand.execute(['install', 'requests'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Installing requests==2.31.0')
      expect(result.stdout).toContain('Python HTTP for Humans.')
      expect(result.stdout).toContain('Successfully installed 1 package')
    })

    it('should list installed packages', async () => {
      // Setup installed packages file
      await mockFilesystem.mkdir('/test/.pip')
      await mockFilesystem.writeFile('/test/.pip/installed.json', JSON.stringify([
        {
          name: 'requests',
          version: '2.31.0',
          location: '/pyodide/site-packages',
          summary: 'Python HTTP for Humans.'
        }
      ]))
      
      const result = await pipCommand.execute(['list'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Package')
      expect(result.stdout).toContain('Version')
      expect(result.stdout).toContain('requests')
      expect(result.stdout).toContain('2.31.0')
    })

    it('should show package information', async () => {
      // Setup installed packages and mock PyPI
      await mockFilesystem.mkdir('/test/.pip')
      await mockFilesystem.writeFile('/test/.pip/installed.json', JSON.stringify([
        {
          name: 'requests',
          version: '2.31.0',
          location: '/pyodide/site-packages',
          summary: 'Python HTTP for Humans.'
        }
      ]))
      
      global.fetch = async (url: RequestInfo | URL) => {
        const urlString = url.toString()
        if (urlString.includes('pypi.org/pypi/requests')) {
          return {
            ok: true,
            json: async () => ({
              info: {
                name: 'requests',
                version: '2.31.0',
                summary: 'Python HTTP for Humans.',
                author: 'Kenneth Reitz',
                license: 'Apache 2.0',
                requires_dist: ['urllib3>=1.21.1']
              }
            })
          } as Response
        }
        throw new Error('Network error')
      }
      
      const result = await pipCommand.execute(['show', 'requests'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Name: requests')
      expect(result.stdout).toContain('Version: 2.31.0')
      expect(result.stdout).toContain('Summary: Python HTTP for Humans.')
      expect(result.stdout).toContain('Author: Kenneth Reitz')
      expect(result.stdout).toContain('License: Apache 2.0')
    })

    it('should show package not found error', async () => {
      const result = await pipCommand.execute(['show', 'nonexistent'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("Package 'nonexistent' not found")
    })

    it('should freeze installed packages', async () => {
      // Setup installed packages
      await mockFilesystem.mkdir('/test/.pip')
      await mockFilesystem.writeFile('/test/.pip/installed.json', JSON.stringify([
        { name: 'requests', version: '2.31.0', location: '/pyodide/site-packages' },
        { name: 'numpy', version: '1.24.3', location: '/pyodide/site-packages' }
      ]))
      
      const result = await pipCommand.execute(['freeze'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('requests==2.31.0')
      expect(result.stdout).toContain('numpy==1.24.3')
    })
  })

  describe('Integration', () => {
    it('should work together for full development workflow', async () => {
      const npmCommand = new NpmCommand()
      const pipCommand = new PipCommand()
      
      // Initialize npm project
      let result = await npmCommand.execute(['init'], options)
      expect(result.exitCode).toBe(0)
      
      // Mock package resolution
      global.fetch = async (url: RequestInfo | URL) => {
        const urlString = url.toString()
        if (urlString.includes('registry.npmjs.org')) {
          return {
            ok: true,
            json: async () => ({
              name: 'express',
              'dist-tags': { latest: '4.18.2' },
              versions: {
                '4.18.2': {
                  name: 'express',
                  version: '4.18.2',
                  description: 'Fast, unopinionated, minimalist web framework'
                }
              }
            })
          } as Response
        } else if (urlString.includes('pypi.org/pypi')) {
          return {
            ok: true,
            json: async () => ({
              info: {
                name: 'flask',
                version: '2.3.2',
                summary: 'A simple framework for building complex web applications.',
                author: 'Armin Ronacher'
              },
              releases: { '2.3.2': [] }
            })
          } as Response
        }
        throw new Error('Network error')
      }
      
      // Install npm package
      result = await npmCommand.execute(['install', 'express'], options)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('+ express@4.18.2')
      
      // Install pip package
      result = await pipCommand.execute(['install', 'flask'], options)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Installing flask==2.3.2')
      
      // List both package managers
      result = await npmCommand.execute(['list'], options)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('express@4.18.2')
      
      result = await pipCommand.execute(['list'], options)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('flask')
      expect(result.stdout).toContain('2.3.2')
    })
  })
})
/**
 * Shared test utilities for ComputeSDK tests
 * 
 * Provides reusable mock implementations for testing across different modules
 */

import { vi } from 'vitest'
import type { FileEntry, Runtime, CodeResult, CommandResult } from '../types/index.js'
import type { ProviderSandboxInfo } from '../types/index.js'

// Note: Provider and ProviderSandbox are defined in @computesdk/provider (mother package)
// For testing the grandmother package (computesdk), we create minimal mock interfaces
interface Provider {
  readonly name: string
  getSupportedRuntimes(): Runtime[]
  readonly sandbox: {
    create(options?: any): Promise<ProviderSandbox>
    getById(sandboxId: string): Promise<ProviderSandbox | null>
    list(): Promise<ProviderSandbox[]>
    destroy(sandboxId: string): Promise<void>
  }
}

interface ProviderSandbox {
  readonly sandboxId: string
  readonly provider: string
  getInstance(): unknown
  runCode(code: string): Promise<CodeResult>
  runCommand(command: string, args?: string[]): Promise<CommandResult>
  getInfo(): Promise<ProviderSandboxInfo>
  getUrl(options: { port: number; protocol?: string }): Promise<string>
  getProvider(): Provider
  destroy(): Promise<void>
  readonly filesystem: {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    mkdir(path: string): Promise<void>
    readdir(path: string): Promise<FileEntry[]>
    exists(path: string): Promise<boolean>
    remove(path: string): Promise<void>
  }
}

/** Standard mock runtime support for testing */
export const MOCK_SUPPORTED_RUNTIMES: Runtime[] = ['node', 'python']

/**
 * Mock sandbox implementation for testing
 */
export class MockSandbox implements ProviderSandbox {
  readonly sandboxId = `mock-sandbox-${Math.random().toString(36).substr(2, 9)}`
  readonly provider = 'mock'
  private _mockInstance = {}  // Mock native instance

  getInstance(): unknown {
    return this._mockInstance
  }

  async runCode(code: string): Promise<CodeResult> {
    return {
      output: `Executed: ${code}`,
      exitCode: 0,
      language: 'node',
    }
  }

  async runCommand(command: string, args: string[] = []): Promise<CommandResult> {
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
    return {
      stdout: `Command executed: ${fullCommand}`,
      stderr: '',
      exitCode: 0,
      durationMs: 50,
    }
  }

  async getInfo(): Promise<ProviderSandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: 'node',
      status: 'running',
      createdAt: new Date(),
      timeout: 30000
    }
  }

  async getUrl(options: { port: number; protocol?: string }): Promise<string> {
    const protocol = options.protocol || 'https'
    return `${protocol}://${options.port}-${this.sandboxId}.mock.dev`
  }

  getProvider(): Provider {
    return (this as any)._mockProvider
  }

  async destroy(): Promise<void> {
    // Mock implementation
  }

  readonly filesystem = {
    async readFile(path: string): Promise<string> {
      return `Mock file content from ${path}`
    },
    async writeFile(path: string, content: string): Promise<void> {
      // Mock implementation
    },
    async mkdir(path: string): Promise<void> {
      // Mock implementation
    },
    async readdir(path: string): Promise<FileEntry[]> {
      return [
        {
          name: 'test.txt',
          type: 'file',
          size: 100,
          modified: new Date()
        }
      ]
    },
    async exists(path: string): Promise<boolean> {
      return true
    },
    async remove(path: string): Promise<void> {
      // Mock implementation
    }
  }


}

/**
 * Mock provider implementation for testing
 */
export class MockProvider implements Provider {
  readonly name = 'mock'

  getSupportedRuntimes(): Runtime[] {
    return MOCK_SUPPORTED_RUNTIMES
  }

  readonly sandbox = {
    create: async (options?: any): Promise<ProviderSandbox> => {
      const sandbox = new MockSandbox()
      ;(sandbox as any)._mockProvider = this
      return sandbox
    },
    getById: async (sandboxId: string): Promise<ProviderSandbox | null> => {
      const sandbox = new MockSandbox()
      ;(sandbox as any)._mockProvider = this
      return sandbox
    },
    list: async (): Promise<ProviderSandbox[]> => {
      const sandbox = new MockSandbox()
      ;(sandbox as any)._mockProvider = this
      return [sandbox]
    },
    destroy: async (sandboxId: string): Promise<void> => {
      // Mock destroy
    }
  }
}

/**
 * Create a mock provider with customizable behavior
 */
export function createMockProvider(overrides?: Partial<Provider>): Provider {
  const mockProvider = new MockProvider()
  return {
    ...mockProvider,
    getSupportedRuntimes: () => MOCK_SUPPORTED_RUNTIMES,
    ...overrides
  }
}

/**
 * Create a mock sandbox with customizable behavior
 */
export function createMockSandbox(overrides?: Partial<MockSandbox>): MockSandbox {
  const mockSandbox = new MockSandbox()
  return Object.assign(mockSandbox, overrides)
}
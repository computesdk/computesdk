/**
 * Shared test utilities for ComputeSDK tests
 * 
 * Provides reusable mock implementations for testing across different modules
 */

import { vi } from 'vitest'
import type { Provider, Sandbox, ExecutionResult, SandboxInfo, FileEntry } from '../types/index.js'

/**
 * Mock sandbox implementation for testing
 */
export class MockSandbox implements Sandbox {
  readonly sandboxId = `mock-sandbox-${Math.random().toString(36).substr(2, 9)}`
  readonly provider = 'mock'
  private _mockInstance = {}  // Mock native instance

  getInstance(): unknown {
    return this._mockInstance
  }

  async runCode(code: string): Promise<ExecutionResult> {
    return {
      stdout: `Executed: ${code}`,
      stderr: '',
      exitCode: 0,
      executionTime: 100,
      sandboxId: this.sandboxId,
      provider: this.provider
    }
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
    return {
      stdout: `Command executed: ${fullCommand}`,
      stderr: '',
      exitCode: 0,
      executionTime: 50,
      sandboxId: this.sandboxId,
      provider: this.provider
    }
  }

  async getInfo(): Promise<SandboxInfo> {
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
    // This will be set by the MockProvider when creating sandboxes
    return (this as any)._mockProvider
  }

  async kill(): Promise<void> {
    // Mock implementation
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
          path: `${path}/test.txt`,
          isDirectory: false,
          size: 100,
          lastModified: new Date()
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
  readonly __sandboxType!: any // Phantom type for testing
  readonly sandbox = {
    create: async (options?: any): Promise<Sandbox> => {
      const sandbox = new MockSandbox()
      ;(sandbox as any)._mockProvider = this
      return sandbox
    },
    getById: async (sandboxId: string): Promise<Sandbox | null> => {
      const sandbox = new MockSandbox()
      ;(sandbox as any)._mockProvider = this
      return sandbox
    },
    list: async (): Promise<Sandbox[]> => {
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
  return { ...mockProvider, __sandboxType: null as any, ...overrides }
}

/**
 * Create a mock sandbox with customizable behavior
 */
export function createMockSandbox(overrides?: Partial<MockSandbox>): MockSandbox {
  const mockSandbox = new MockSandbox()
  return Object.assign(mockSandbox, overrides)
}
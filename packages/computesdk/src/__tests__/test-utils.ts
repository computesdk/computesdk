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

  readonly terminal = {
    async create(): Promise<any> {
      return {
        pid: 123,
        command: 'bash',
        status: 'running',
        cols: 80,
        rows: 24,
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined)
      }
    },
    async getById(terminalId: string): Promise<any> {
      if (terminalId === '123') {
        return {
          pid: 123,
          command: 'bash',
          status: 'running',
          cols: 80,
          rows: 24,
          write: vi.fn().mockResolvedValue(undefined),
          resize: vi.fn().mockResolvedValue(undefined),
          kill: vi.fn().mockResolvedValue(undefined)
        }
      }
      return null
    },
    async list(): Promise<any[]> {
      return [{
        pid: 123,
        command: 'bash',
        status: 'running',
        cols: 80,
        rows: 24,
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined)
      }]
    },
    async destroy(terminalId: string): Promise<void> {
      // Mock destroy
    }
  }
}

/**
 * Mock provider implementation for testing
 */
export class MockProvider implements Provider {
  readonly name = 'mock'
  readonly sandbox = {
    async create(options?: any): Promise<Sandbox> {
      return new MockSandbox()
    },
    async getById(sandboxId: string): Promise<Sandbox | null> {
      return new MockSandbox()
    },
    async list(): Promise<Sandbox[]> {
      return [new MockSandbox()]
    },
    async destroy(sandboxId: string): Promise<void> {
      // Mock destroy
    }
  }
}

/**
 * Create a mock provider with customizable behavior
 */
export function createMockProvider(overrides?: Partial<Provider>): Provider {
  const mockProvider = new MockProvider()
  return { ...mockProvider, ...overrides }
}

/**
 * Create a mock sandbox with customizable behavior
 */
export function createMockSandbox(overrides?: Partial<MockSandbox>): MockSandbox {
  const mockSandbox = new MockSandbox()
  return Object.assign(mockSandbox, overrides)
}
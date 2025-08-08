import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseProvider } from '../../providers/base'
import type { ExecutionResult, SandboxInfo, Runtime } from '../../types'

// Create a concrete implementation for testing
class TestProvider extends BaseProvider {
  public readonly sandboxId: string;

  constructor(provider: string, timeout: number, sandboxId?: string) {
    super(provider, timeout);
    this.sandboxId = sandboxId || 'test-sandbox-123';
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    return {
      stdout: `Executed: ${code}`,
      stderr: '',
      exitCode: 0,
      executionTime: 100,
      sandboxId: this.sandboxId,
      provider: this.provider
    }
  }

  async doKill(): Promise<void> {
    // Mock implementation
  }

  async doGetInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: 'node' as Runtime,
      status: 'running',
      createdAt: new Date(),
      timeout: this.timeout
    }
  }
}

describe('BaseProvider', () => {
  let provider: TestProvider

  beforeEach(() => {
    provider = new TestProvider('test', 5000)
  })

  describe('constructor', () => {
    it('should initialize with provider name and timeout', () => {
      expect(provider.provider).toBe('test')
      expect(provider.sandboxId).toBe('test-sandbox-123')
    })

    it('should use provided sandbox IDs', () => {
      const provider2 = new TestProvider('test', 5000, 'custom-sandbox-456')
      expect(provider.sandboxId).toBe('test-sandbox-123')
      expect(provider2.sandboxId).toBe('custom-sandbox-456')
    })
  })

  describe('execute', () => {
    it('should execute code and track execution time', async () => {
      const result = await provider.execute('console.log("test")')
      
      expect(result.stdout).toBe('Executed: console.log("test")')
      expect(result.exitCode).toBe(0)
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.sandboxId).toBe(provider.sandboxId)
      expect(result.provider).toBe('test')
    })

    it('should timeout after specified duration', async () => {
      // Override doExecute to simulate long-running code
      provider.doExecute = async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 0,
          sandboxId: provider.sandboxId,
          provider: provider.provider
        }
      }

      // Create provider with very short timeout
      const shortTimeoutProvider = new TestProvider('test', 50)
      shortTimeoutProvider.doExecute = provider.doExecute

      await expect(shortTimeoutProvider.execute('long running code'))
        .rejects.toThrow('Execution timed out after 50ms')
    })

    it('should pass runtime parameter to doExecute', async () => {
      const doExecuteSpy = vi.spyOn(provider, 'doExecute')
      
      await provider.execute('print("test")', 'python')
      
      expect(doExecuteSpy).toHaveBeenCalledWith('print("test")', 'python')
    })
  })

  describe('kill', () => {
    it('should call doKill', async () => {
      const doKillSpy = vi.spyOn(provider, 'doKill')
      
      await provider.kill()
      
      expect(doKillSpy).toHaveBeenCalled()
    })
  })

  describe('getInfo', () => {
    it('should return sandbox information', async () => {
      const info = await provider.getInfo()
      
      expect(info.id).toBe(provider.sandboxId)
      expect(info.provider).toBe('test')
      expect(info.runtime).toBe('node')
      expect(info.status).toBe('running')
      expect(info.timeout).toBe(5000)
    })
  })
})
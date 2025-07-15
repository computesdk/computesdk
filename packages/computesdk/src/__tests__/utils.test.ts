import { describe, it, expect, vi } from 'vitest'
import { executeSandbox, retry } from '../utils'
import type { ComputeSandbox, ExecutionResult } from '../types'

describe('Utils', () => {
  describe('executeSandbox', () => {
    it('should execute code in sandbox', async () => {
      const mockResult: ExecutionResult = {
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        sandboxId: 'test-sandbox',
        provider: 'mock'
      }

      const mockSandbox: ComputeSandbox = {
        provider: 'mock',
        sandboxId: 'test-sandbox',
        execute: vi.fn().mockResolvedValue(mockResult),
        runCode: vi.fn(),
        runCommand: vi.fn(),
        kill: vi.fn(),
        getInfo: vi.fn()
      }

      const result = await executeSandbox({
        sandbox: mockSandbox,
        code: 'print("Hello World")'
      })

      expect(result).toEqual(mockResult)
      expect(mockSandbox.execute).toHaveBeenCalledWith('print("Hello World")', undefined)
    })

    it('should pass runtime to execute method', async () => {
      const mockSandbox: ComputeSandbox = {
        provider: 'mock',
        sandboxId: 'test-sandbox',
        execute: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          sandboxId: 'test-sandbox',
          provider: 'mock'
        }),
        runCode: vi.fn(),
        runCommand: vi.fn(),
        kill: vi.fn(),
        getInfo: vi.fn()
      }

      await executeSandbox({
        sandbox: mockSandbox,
        code: 'console.log("test")',
        runtime: 'node'
      })

      expect(mockSandbox.execute).toHaveBeenCalledWith('console.log("test")', 'node')
    })
  })

  describe('retry', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success')
      
      const result = await retry(fn)
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success')
      
      const result = await retry(fn, { maxAttempts: 3 })
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'))
      
      await expect(retry(fn, { maxAttempts: 3 })).rejects.toThrow('Always fails')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should use custom delay', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue('success')
      
      const start = Date.now()
      const result = await retry(fn, { 
        maxAttempts: 2, 
        delay: 50,
        backoff: 1 // No exponential backoff
      })
      const duration = Date.now() - start
      
      expect(result).toBe('success')
      expect(duration).toBeGreaterThanOrEqual(50)
      expect(duration).toBeLessThan(150) // Should be around 50ms
    })

    it('should apply exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success')
      
      const result = await retry(fn, { 
        maxAttempts: 3, 
        delay: 50,
        backoff: 2
      })
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn()
      const error = new Error('Retry me')
      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success')
      
      const result = await retry(fn, { 
        maxAttempts: 2,
        onRetry
      })
      
      expect(result).toBe('success')
      expect(onRetry).toHaveBeenCalledWith(error, 1)
    })
  })
})
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCodeExecutionHook } from '../src/hooks/useCodeExecution.js'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useCodeExecution hook', () => {
  let hook: ReturnType<typeof createCodeExecutionHook>

  beforeEach(() => {
    mockFetch.mockClear()
    hook = createCodeExecutionHook()
  })

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = hook.getState()
      expect(state).toEqual({
        code: '',
        runtime: 'python',
        isExecuting: false,
        result: null,
        error: null
      })
    })
  })

  describe('state management', () => {
    it('should update code', () => {
      hook.setCode('print("hello")')
      const state = hook.getState()
      expect(state.code).toBe('print("hello")')
    })

    it('should update runtime', () => {
      hook.setRuntime('javascript')
      const state = hook.getState()
      expect(state.runtime).toBe('javascript')
    })

    it('should clear result and error', () => {
      // First set some state
      hook.setCode('test')
      hook.clearResult()
      
      const state = hook.getState()
      expect(state.result).toBeNull()
      expect(state.error).toBeNull()
    })
  })

  describe('subscription system', () => {
    it('should notify subscribers on state changes', () => {
      const listener = vi.fn()
      const unsubscribe = hook.subscribe(listener)

      hook.setCode('new code')
      expect(listener).toHaveBeenCalledTimes(1)

      hook.setRuntime('javascript')
      expect(listener).toHaveBeenCalledTimes(2)

      unsubscribe()
      hook.setCode('another code')
      expect(listener).toHaveBeenCalledTimes(2) // Should not be called after unsubscribe
    })

    it('should handle multiple subscribers', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      
      hook.subscribe(listener1)
      hook.subscribe(listener2)

      hook.setCode('test')
      
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })
  })

  describe('code execution', () => {
    it('should handle successful execution', async () => {
      const mockResponse = {
        success: true,
        result: {
          output: 'Hello, World!',
          executionTime: 1500,
          provider: 'e2b'
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      hook.setCode('print("Hello, World!")')
      await hook.executeCode()

      const state = hook.getState()
      expect(state.result).toEqual(mockResponse)
      expect(state.error).toBeNull()
      expect(state.isExecuting).toBe(false)
    })

    it('should handle execution errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Invalid code' })
      })

      hook.setCode('invalid code')
      await hook.executeCode()

      const state = hook.getState()
      expect(state.error).toBe('Invalid code')
      expect(state.result).toBeNull()
      expect(state.isExecuting).toBe(false)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      hook.setCode('print("test")')
      await hook.executeCode()

      const state = hook.getState()
      expect(state.error).toBe('Failed to fetch')
      expect(state.result).toBeNull()
      expect(state.isExecuting).toBe(false)
    })

    it('should not execute empty code', async () => {
      hook.setCode('')
      await hook.executeCode()

      const state = hook.getState()
      expect(state.error).toBe('Please enter some code to execute')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should set isExecuting during execution', async () => {
      let resolvePromise: (value: any) => void
      const promise = new Promise(resolve => {
        resolvePromise = resolve
      })

      mockFetch.mockReturnValueOnce(promise)

      hook.setCode('print("test")')
      const executionPromise = hook.executeCode()

      // Check that isExecuting is true during execution
      expect(hook.getState().isExecuting).toBe(true)

      // Resolve the promise
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ success: true, result: { output: 'test', executionTime: 100, provider: 'test' } })
      })

      await executionPromise

      // Check that isExecuting is false after execution
      expect(hook.getState().isExecuting).toBe(false)
    })

    it('should use custom API endpoint', async () => {
      const mockResponse = { success: true }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      hook.setCode('console.log("test")')
      await hook.executeCode('/custom/endpoint')

      expect(mockFetch).toHaveBeenCalledWith('/custom/endpoint', expect.any(Object))
    })
  })
})
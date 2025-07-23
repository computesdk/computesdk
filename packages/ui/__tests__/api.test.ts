import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeCode, APIError, formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('API utilities', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  describe('executeCode', () => {
    it('should make successful API call', async () => {
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
      } as Response)

      const result = await executeCode({
        code: 'print("Hello, World!")',
        runtime: 'python'
      })

      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith('/api/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: 'print("Hello, World!")',
          runtime: 'python'
        }),
      })
    })

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Invalid code' })
      } as Response)

      await expect(executeCode({
        code: 'invalid code',
        runtime: 'python'
      })).rejects.toThrow(APIError)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(executeCode({
        code: 'print("test")',
        runtime: 'python'
      })).rejects.toThrow(APIError)
    })

    it('should use custom endpoint', async () => {
      const mockResponse = { success: true }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      await executeCode({
        code: 'console.log("test")',
        runtime: 'javascript'
      }, '/custom/endpoint')

      expect(mockFetch).toHaveBeenCalledWith('/custom/endpoint', expect.any(Object))
    })
  })

  describe('formatExecutionTime', () => {
    it('should format milliseconds', () => {
      expect(formatExecutionTime(500)).toBe('500ms')
      expect(formatExecutionTime(999)).toBe('999ms')
    })

    it('should format seconds', () => {
      expect(formatExecutionTime(1000)).toBe('1.0s')
      expect(formatExecutionTime(1500)).toBe('1.5s')
      expect(formatExecutionTime(30000)).toBe('30.0s')
    })

    it('should format minutes and seconds', () => {
      expect(formatExecutionTime(60000)).toBe('1m 0s')
      expect(formatExecutionTime(90000)).toBe('1m 30s')
      expect(formatExecutionTime(125000)).toBe('2m 5s')
    })
  })

  describe('formatOutput', () => {
    it('should trim whitespace', () => {
      expect(formatOutput('  hello world  \n')).toBe('hello world')
      expect(formatOutput('\t\ntest\n\t')).toBe('test')
    })

    it('should handle empty strings', () => {
      expect(formatOutput('')).toBe('')
      expect(formatOutput('   ')).toBe('')
    })
  })

  describe('isExecutionError', () => {
    it('should detect failed executions', () => {
      expect(isExecutionError({ success: false })).toBe(true)
      expect(isExecutionError({ success: true, error: 'Something went wrong' })).toBe(true)
      expect(isExecutionError({ 
        success: true, 
        result: { 
          output: '', 
          error: 'Runtime error',
          executionTime: 100,
          provider: 'test'
        } 
      })).toBe(true)
    })

    it('should detect successful executions', () => {
      expect(isExecutionError({ success: true })).toBe(false)
      expect(isExecutionError({ 
        success: true, 
        result: { 
          output: 'Hello', 
          executionTime: 100,
          provider: 'test'
        } 
      })).toBe(false)
    })
  })

  describe('getErrorMessage', () => {
    it('should extract error messages', () => {
      expect(getErrorMessage({ success: false, error: 'Main error' })).toBe('Main error')
      expect(getErrorMessage({ 
        success: true, 
        result: { 
          output: '', 
          error: 'Runtime error',
          executionTime: 100,
          provider: 'test'
        } 
      })).toBe('Runtime error')
      expect(getErrorMessage({ success: false })).toBe('Execution failed')
    })
  })
})
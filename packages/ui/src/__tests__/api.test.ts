import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeComputeRequest, APIError, formatExecutionTime, formatOutput, isComputeError, getErrorMessage } from '../utils/api.js'
import type { ComputeResponse } from '../types/index.js'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('API utilities', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  describe('executeComputeRequest', () => {
    it('should make successful API request', async () => {
      const mockResponse: ComputeResponse = {
        success: true,
        sandboxId: 'test-123',
        provider: 'e2b'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      const result = await executeComputeRequest({
        action: 'compute.sandbox.create'
      })

      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith('/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compute.sandbox.create' })
      })
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Invalid request' })
      })

      await expect(executeComputeRequest({
        action: 'compute.sandbox.create'
      })).rejects.toThrow(APIError)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

      await expect(executeComputeRequest({
        action: 'compute.sandbox.create'
      })).rejects.toThrow('Network error: Unable to connect to the API endpoint')
    })
  })

  describe('formatExecutionTime', () => {
    it('should format milliseconds', () => {
      expect(formatExecutionTime(500)).toBe('500ms')
    })

    it('should format seconds', () => {
      expect(formatExecutionTime(1500)).toBe('1.5s')
    })

    it('should format minutes', () => {
      expect(formatExecutionTime(125000)).toBe('2m 5s')
    })
  })

  describe('formatOutput', () => {
    it('should trim whitespace', () => {
      expect(formatOutput('  hello world  \n')).toBe('hello world')
    })
  })

  describe('isComputeError', () => {
    it('should detect error responses', () => {
      expect(isComputeError({ success: false, sandboxId: '', provider: '' })).toBe(true)
      expect(isComputeError({ success: true, error: 'test', sandboxId: '', provider: '' })).toBe(true)
      expect(isComputeError({ success: true, sandboxId: '', provider: '' })).toBe(false)
    })
  })

  describe('getErrorMessage', () => {
    it('should extract error messages', () => {
      expect(getErrorMessage({ success: false, error: 'test error', sandboxId: '', provider: '' })).toBe('test error')
      expect(getErrorMessage({ success: false, sandboxId: '', provider: '' })).toBe('Operation failed')
      expect(getErrorMessage({ success: true, sandboxId: '', provider: '' })).toBe('Unknown error')
    })
  })
})
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleComputeRequest, handleHttpComputeRequest } from '../request-handler.js'
import type { ComputeRequest } from '../request-handler.js'
import { MockProvider } from './test-utils.js'

describe('Request Handler', () => {
  let mockProvider: MockProvider

  beforeEach(() => {
    mockProvider = new MockProvider()
    vi.clearAllMocks()
  })

  describe('handleComputeRequest', () => {
    describe('Sandbox operations', () => {
      it('should handle sandbox create action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.create',
          options: { runtime: 'python' }
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.sandboxId).toMatch(/^mock-sandbox-/)
        expect(result.provider).toBe('mock')
      })

      it('should handle sandbox destroy action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.destroy',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.sandboxId).toBe('test-sandbox-id')
        expect(result.provider).toBe('mock')
      })

      it('should handle sandbox getInfo action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.getInfo',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.sandboxId).toBe('test-sandbox-id')
        expect(result.provider).toBe('mock')
        expect(result.info).toBeDefined()
        expect(result.info?.id).toMatch(/^mock-sandbox-/)
      })

      it('should handle sandbox list action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.list'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.provider).toBe('mock')
        expect(result.sandboxes).toBeDefined()
        expect(Array.isArray(result.sandboxes)).toBe(true)
      })

      it('should return error for destroy without sandboxId', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.destroy'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('sandboxId is required for destroy action')
      })
    })

    describe('Code execution', () => {
      it('should handle runCode action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCode',
          sandboxId: 'test-sandbox-id',
          code: 'print("Hello World")',
          runtime: 'python'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.result).toBeDefined()
        expect(result.result?.stdout).toBe('Executed: print("Hello World")')
        expect(result.result?.exitCode).toBe(0)
      })

      it('should handle runCommand action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCommand',
          sandboxId: 'test-sandbox-id',
          command: 'ls',
          args: ['-la']
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.result).toBeDefined()
        expect(result.result?.stdout).toBe('Command executed: ls -la')
        expect(result.result?.exitCode).toBe(0)
      })

      it('should return error for runCode without code', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCode',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('code is required')
      })

      it('should return error for runCommand without command', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCommand',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('command is required')
      })
    })

    describe('Filesystem operations', () => {
      it('should handle filesystem readFile action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readFile',
          sandboxId: 'test-sandbox-id',
          path: '/test/file.txt'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.fileContent).toBe('Mock file content from /test/file.txt')
      })

      it('should handle filesystem writeFile action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.writeFile',
          sandboxId: 'test-sandbox-id',
          path: '/test/file.txt',
          content: 'Hello World'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
      })

      it('should handle filesystem mkdir action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.mkdir',
          sandboxId: 'test-sandbox-id',
          path: '/test/new-dir'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
      })

      it('should handle filesystem readdir action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readdir',
          sandboxId: 'test-sandbox-id',
          path: '/test'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.files).toBeDefined()
        expect(Array.isArray(result.files)).toBe(true)
        expect(result.files?.[0]?.name).toBe('test.txt')
        expect(result.files?.[0]?.isDirectory).toBe(false)
      })

      it('should handle filesystem exists action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.exists',
          sandboxId: 'test-sandbox-id',
          path: '/test/file.txt'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
        expect(result.exists).toBe(true)
      })

      it('should handle filesystem remove action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.remove',
          sandboxId: 'test-sandbox-id',
          path: '/test/file.txt'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(true)
      })

      it('should return error for filesystem operations without sandboxId', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readFile',
          path: '/test/file.txt'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('sandboxId is required for this action')
      })

      it('should return error for filesystem operations without path', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readFile',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('path is required')
      })
    })

    describe('Error handling', () => {
      it('should handle unknown actions', async () => {
        const request: ComputeRequest = {
          action: 'unknown.action',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest(request, mockProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('Unknown action: unknown.action')
      })

      it('should handle provider errors', async () => {
        const errorProvider = {
          ...mockProvider,
          sandbox: {
            ...mockProvider.sandbox,
            create: vi.fn().mockRejectedValue(new Error('Provider error'))
          }
        }

        const request: ComputeRequest = {
          action: 'compute.sandbox.create'
        }

        const response = await handleComputeRequest(request, errorProvider)
        const result = await response.json()

        expect(result.success).toBe(false)
        expect(result.error).toBe('Provider error')
      })
    })
  })

  describe('handleHttpComputeRequest', () => {
    it('should handle POST requests with JSON body', async () => {
      const requestBody = {
        action: 'compute.sandbox.create',
        options: { runtime: 'python' }
      }

      const mockRequest = new Request('http://localhost/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const response = await handleHttpComputeRequest(mockRequest, mockProvider)
      const result = await response.json()

      expect(result.success).toBe(true)
      expect(result.sandboxId).toMatch(/^mock-sandbox-/)
    })

    it('should return error for unsupported GET requests', async () => {
      const mockRequest = new Request('http://localhost/api/compute', {
        method: 'GET'
      })

      const response = await handleHttpComputeRequest(mockRequest, mockProvider)
      const result = await response.json()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Only POST requests are supported')
    })

    it('should handle invalid JSON in POST requests', async () => {
      const mockRequest = new Request('http://localhost/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      })

      const response = await handleHttpComputeRequest(mockRequest, mockProvider)
      const result = await response.json()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid JSON in request body')
    })
  })
})
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

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.sandboxId).toMatch(/^mock-sandbox-/)
        expect(response.provider).toBe('mock')
      })

      it('should handle sandbox destroy action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.destroy',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.sandboxId).toBe('test-sandbox-id')
        expect(response.provider).toBe('mock')
      })

      it('should handle sandbox getInfo action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.getInfo',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.sandboxId).toBe('test-sandbox-id')
        expect(response.provider).toBe('mock')
        expect(response.info).toBeDefined()
        expect(response.info?.id).toMatch(/^mock-sandbox-/)
      })

      it('should handle sandbox list action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.list'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.provider).toBe('mock')
        expect(response.sandboxes).toBeDefined()
        expect(Array.isArray(response.sandboxes)).toBe(true)
      })

      it('should return error for destroy without sandboxId', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.destroy'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Sandbox ID is required for destroy action')
      })
    })

    describe('Code execution', () => {
      it('should handle runCode action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCode',
          code: 'print("Hello World")',
          runtime: 'python',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.result).toBeDefined()
        expect(response.result?.stdout).toBe('Executed: print("Hello World")')
        expect(response.result?.exitCode).toBe(0)
      })

      it('should handle runCommand action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCommand',
          command: 'ls',
          args: ['-la'],
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.result).toBeDefined()
        expect(response.result?.stdout).toBe('Command executed: ls -la')
        expect(response.result?.exitCode).toBe(0)
      })

      it('should return error for runCode without code', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCode',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Code is required for runCode action')
      })

      it('should return error for runCommand without command', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.runCommand',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Command is required for runCommand action')
      })
    })

    describe('Filesystem operations', () => {
      it('should handle filesystem readFile action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readFile',
          sandboxId: 'test-sandbox-id',
          path: '/test.txt'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.fileContent).toBe('Mock file content from /test.txt')
      })

      it('should handle filesystem writeFile action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.writeFile',
          sandboxId: 'test-sandbox-id',
          path: '/test.txt',
          content: 'new content'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should handle filesystem mkdir action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.mkdir',
          sandboxId: 'test-sandbox-id',
          path: '/new-dir'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should handle filesystem readdir action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readdir',
          sandboxId: 'test-sandbox-id',
          path: '/'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.files).toBeDefined()
        expect(Array.isArray(response.files)).toBe(true)
        expect(response.files?.length).toBe(1)
        expect(response.files?.[0].name).toBe('test.txt')
      })

      it('should handle filesystem exists action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.exists',
          sandboxId: 'test-sandbox-id',
          path: '/test.txt'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.exists).toBe(true)
      })

      it('should handle filesystem remove action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.remove',
          sandboxId: 'test-sandbox-id',
          path: '/test.txt'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should return error for filesystem operations without sandboxId', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readFile',
          path: '/test.txt'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Sandbox ID is required for filesystem operations')
      })

      it('should return error for filesystem operations without path', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.filesystem.readFile',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('File path is required for readFile action')
      })
    })

    describe('Terminal operations', () => {
      it('should handle terminal create action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.create',
          sandboxId: 'test-sandbox-id',
          terminalOptions: { command: 'bash', cols: 80, rows: 24 }
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.terminal).toBeDefined()
        expect(response.terminal?.pid).toBe(123)
        expect(response.terminal?.command).toBe('bash')
      })

      it('should handle terminal getById action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.getById',
          sandboxId: 'test-sandbox-id',
          terminalId: '123'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.terminal).toBeDefined()
        expect(response.terminal?.pid).toBe(123)
      })

      it('should handle terminal list action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.list',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
        expect(response.terminals).toBeDefined()
        expect(Array.isArray(response.terminals)).toBe(true)
      })

      it('should handle terminal destroy action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.destroy',
          sandboxId: 'test-sandbox-id',
          terminalId: '123'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should handle terminal write action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.write',
          sandboxId: 'test-sandbox-id',
          terminalId: '123',
          data: 'ls -la\n'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should handle terminal resize action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.resize',
          sandboxId: 'test-sandbox-id',
          terminalId: '123',
          cols: 100,
          rows: 30
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should handle terminal kill action', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.kill',
          sandboxId: 'test-sandbox-id',
          terminalId: '123'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(true)
      })

      it('should return error for terminal operations without sandboxId', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.create'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Sandbox ID is required for terminal operations')
      })

      it('should return error for terminal operations without terminalId', async () => {
        const request: ComputeRequest = {
          action: 'compute.sandbox.terminal.getById',
          sandboxId: 'test-sandbox-id'
        }

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Terminal ID is required for getById action')
      })
    })

    describe('Error handling', () => {
      it('should handle unknown actions', async () => {
        const request = {
          action: 'unknown.action'
        } as any

        const response = await handleComputeRequest({ request, provider: mockProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Unknown action: unknown.action')
      })

      it('should handle provider errors', async () => {
        const errorProvider = new MockProvider()
        errorProvider.sandbox.create = vi.fn().mockRejectedValue(new Error('Provider error'))

        const request: ComputeRequest = {
          action: 'compute.sandbox.create'
        }

        const response = await handleComputeRequest({ request, provider: errorProvider })

        expect(response.success).toBe(false)
        expect(response.error).toBe('Provider error')
      })
    })
  })

  describe('handleHttpComputeRequest', () => {
    it('should handle POST requests with JSON body', async () => {
      const requestBody = {
        action: 'compute.sandbox.create',
        options: { runtime: 'python' }
      }

      const mockRequest = {
        method: 'POST',
        json: vi.fn().mockResolvedValue(requestBody)
      } as any

      const response = await handleHttpComputeRequest({
        request: mockRequest,
        provider: mockProvider
      })

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.sandboxId).toMatch(/^mock-sandbox-/)
    })

    it('should handle GET requests for terminal streaming', async () => {
      const mockRequest = {
        method: 'GET',
        url: 'http://localhost/api/compute?action=terminal.stream&sandboxId=test-123&terminalId=123'
      } as any

      const response = await handleHttpComputeRequest({
        request: mockRequest,
        provider: mockProvider
      })

      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
    })

    it('should return error for unsupported GET requests', async () => {
      const mockRequest = {
        method: 'GET',
        url: 'http://localhost/api/compute?action=unsupported'
      } as any

      const response = await handleHttpComputeRequest({
        request: mockRequest,
        provider: mockProvider
      })

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('GET requests only supported for terminal.stream action')
    })

    it('should handle invalid JSON in POST requests', async () => {
      const mockRequest = {
        method: 'POST',
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      } as any

      const response = await handleHttpComputeRequest({
        request: mockRequest,
        provider: mockProvider
      })

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Invalid JSON')
    })
  })
})
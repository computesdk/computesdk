import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineProvider } from '../factory.js'
import type { CommandResult, SandboxInfo } from '../types/index.js'

const {
  daemonSeedScriptCommand,
  parseSeedInvocationOutput,
} = vi.hoisted(() => ({
  daemonSeedScriptCommand: vi.fn(),
  parseSeedInvocationOutput: vi.fn(),
}))

vi.mock('daemond', () => ({
  daemonSeedScriptCommand,
  parseSeedInvocationOutput,
}))

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('Factory', () => {
  describe('defineProvider', () => {
    it('should create a provider factory function', () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-123', status: 'running' },
          sandboxId: 'test-123'
        }),
        getById: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-123', status: 'running' },
          sandboxId: 'test-123'
        }),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'Command output',
          stderr: '',
          exitCode: 0,
          durationMs: 50
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-123',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {}
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      expect(typeof providerFactory).toBe('function')

      // Create provider instance
      const config = { apiKey: 'test-key' }
      const provider = providerFactory(config)

      expect(provider.name).toBe('mock')
      expect(provider.sandbox).toBeDefined()
      expect(typeof provider.sandbox.create).toBe('function')
      expect(typeof provider.sandbox.getById).toBe('function')
      expect(typeof provider.sandbox.list).toBe('function')
      expect(typeof provider.sandbox.destroy).toBe('function')
    })

    it('should create sandbox instances with core methods', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-123', status: 'running' },
          sandboxId: 'test-123'
        }),
        getById: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-123', status: 'running' },
          sandboxId: 'test-123'
        }),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'ls output',
          stderr: '',
          exitCode: 0,
          durationMs: 50
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-123',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const config = { apiKey: 'test-key' }
      const provider = providerFactory(config)
      const sandbox = await provider.sandbox.create()

      expect(sandbox.sandboxId).toBe('test-123')
      expect(typeof sandbox.runCommand).toBe('function')
      expect(typeof sandbox.getInfo).toBe('function')
      expect(typeof sandbox.destroy).toBe('function')

      const commandResult = await sandbox.runCommand('ls')
      expect(commandResult.stdout).toBe('ls output')
      expect(commandResult.exitCode).toBe(0)

      const info = await sandbox.getInfo()
      expect(info.id).toBe('test-123')
      expect(info.provider).toBe('mock')

      // Test getUrl method
      const url = await sandbox.getUrl({ port: 3000 })
      expect(url).toBe('https://test-123-3000.mock.dev')
      expect(methods.getUrl).toHaveBeenCalledWith(
        { id: 'test-123', status: 'running' },
        { port: 3000 }
      )
    })

    it('should call getUrl with protocol option', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-456', status: 'running' },
          sandboxId: 'test-456'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 50
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-456',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('wss://test-456-8080.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()

      const url = await sandbox.getUrl({ port: 8080, protocol: 'wss' })
      expect(url).toBe('wss://test-456-8080.mock.dev')
      expect(methods.getUrl).toHaveBeenCalledWith(
        { id: 'test-456', status: 'running' },
        { port: 8080, protocol: 'wss' }
      )
    })

    it('should run command through daemon transport when callbacks are provided', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-789', status: 'running' },
          sandboxId: 'test-789'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'daemon invocation output',
          stderr: '',
          exitCode: 0,
          durationMs: 35
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-789',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-789-3000.mock.dev')
      }

      daemonSeedScriptCommand.mockReturnValue('node -e "seed" "pwd"')
      parseSeedInvocationOutput.mockReturnValue({
        token: 'tok',
        requestId: 'req_1',
        daemon: { reused: true, pid: 1, sseUrl: 'http://127.0.0.1:33937/events?token=tok' },
        command: {
          exitCode: 0,
          signal: null,
          stdout: '/workspace\n',
          stderr: '',
          combined: '/workspace\n',
        },
      })

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()
      const onStdout = vi.fn()
      const onStderr = vi.fn()
      const result = await sandbox.runCommand('pwd', {
        cwd: '/workspace',
        timeout: 12,
        onStdout,
        onStderr,
      })

      expect(daemonSeedScriptCommand).toHaveBeenNthCalledWith(
        1,
        { ssePort: 38989 },
        {
          command: 'sh',
          args: ['-lc', 'true'],
          cwd: '/workspace',
          env: undefined,
          timeoutMs: 12,
          requestId: expect.any(String),
        }
      )
      expect(daemonSeedScriptCommand).toHaveBeenNthCalledWith(
        2,
        { ssePort: 38989 },
        {
          command: 'sh',
          args: ['-lc', 'pwd'],
          cwd: '/workspace',
          env: undefined,
          timeoutMs: 12,
          requestId: expect.any(String),
        }
      )
      expect(methods.runCommand).toHaveBeenNthCalledWith(
        2,
        { id: 'test-789', status: 'running' },
        'node -e "seed" "pwd"',
        {
          cwd: '/workspace',
          timeout: 12,
        }
      )
      expect(parseSeedInvocationOutput).toHaveBeenCalledWith('daemon invocation output')
      expect(result).toEqual({
        stdout: '/workspace\n',
        stderr: '',
        exitCode: 0,
        durationMs: 35,
      })
      expect(onStdout).toHaveBeenCalledWith('/workspace\n')
      expect(onStderr).not.toHaveBeenCalled()
    })

    it('should reject streaming callbacks when background is true', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-790', status: 'running' },
          sandboxId: 'test-790'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-790',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-790-3000.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()

      await expect(
        sandbox.runCommand('pwd', { onStdout: vi.fn(), background: true })
      ).rejects.toThrow('runCommand with streaming callbacks does not support background mode.')
    })

    it('should not fail daemon command when provider cannot expose SSE URL', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-792', status: 'running' },
          sandboxId: 'test-792'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'daemon invocation output',
          stderr: '',
          exitCode: 0,
          durationMs: 21
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-792',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockRejectedValue(new Error('port not exposed'))
      }

      daemonSeedScriptCommand.mockReturnValue('node -e "seed" "echo hi"')
      parseSeedInvocationOutput.mockReturnValue({
        token: 'tok',
        requestId: 'req_2',
        daemon: { reused: true, pid: 42, sseUrl: 'http://127.0.0.1:33937/events?token=tok' },
        command: {
          exitCode: 0,
          signal: null,
          stdout: 'hi\n',
          stderr: '',
          combined: 'hi\n',
        },
      })

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()
      const onStdout = vi.fn()
      const result = await sandbox.runCommand('echo hi', { onStdout })

      expect(result.stdout).toBe('hi\n')
      expect(onStdout).toHaveBeenCalledWith('hi\n')
    })

    it('should derive daemon SSE URL host via getUrl', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-793', status: 'running' },
          sandboxId: 'test-793'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'daemon invocation output',
          stderr: '',
          exitCode: 0,
          durationMs: 18
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-793',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://derived.mock.dev')
      }

      daemonSeedScriptCommand.mockReturnValue('node -e "seed" "echo hi"')
      parseSeedInvocationOutput.mockReturnValue({
        token: 'tok',
        requestId: 'req_3',
        daemon: { reused: false, pid: 99, sseUrl: 'https://evil.example:33937/events?token=tok' },
        command: {
          exitCode: 0,
          signal: null,
          stdout: 'safe\n',
          stderr: '',
          combined: 'safe\n',
        },
      })

      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock as any)

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()
      const onStdout = vi.fn()
      const result = await sandbox.runCommand('echo hi', { onStdout })

      expect(result.stdout).toBe('safe\n')
      expect(onStdout).toHaveBeenCalledWith('safe\n')
      expect(methods.getUrl).toHaveBeenCalledWith(
        { id: 'test-793', status: 'running' },
        { port: 33937 }
      )
      expect(fetchMock).toHaveBeenCalledWith('https://derived.mock.dev/events?token=tok', expect.any(Object))
    })

    it('should throw AbortError when signal is already aborted before create', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-abort', status: 'running' },
          sandboxId: 'test-abort'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-abort',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-abort-3000.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const controller = new AbortController()
      controller.abort()

      await expect(provider.sandbox.create({ signal: controller.signal })).rejects.toThrow('The operation was aborted.')
      expect(methods.create).not.toHaveBeenCalled()
    })

    it('should destroy sandbox and throw AbortError when signal aborts during create', async () => {
      const methods = {
        create: vi.fn().mockImplementation(async () => {
          // Simulate creation completing after abort
          return {
            sandbox: { id: 'test-orphan', status: 'running' },
            sandboxId: 'test-orphan'
          }
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-orphan',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-orphan-3000.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const controller = new AbortController()
      const createPromise = provider.sandbox.create({ signal: controller.signal })
      controller.abort()

      await expect(createPromise).rejects.toThrow('The operation was aborted.')
      expect(methods.create).toHaveBeenCalled()
      expect(methods.destroy).toHaveBeenCalledWith({ apiKey: 'test-key' }, 'test-orphan')
    })

    it('should reject immediately when abort fires during slow create and clean up the sandbox', async () => {
      let resolveCreate: (value: any) => void
      const createPromise = new Promise<any>((resolve) => {
        resolveCreate = resolve
      })
      const methods = {
        create: vi.fn().mockReturnValue(createPromise),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 1
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-slow',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-slow-3000.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const controller = new AbortController()
      const promise = provider.sandbox.create({ signal: controller.signal })

      controller.abort()
      await expect(promise).rejects.toThrow('The operation was aborted.')
      expect(methods.create).toHaveBeenCalled()

      // Resolve the provider promise after abort — cleanup should still run
      resolveCreate!({ sandbox: { id: 'test-slow' }, sandboxId: 'test-slow' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(methods.destroy).toHaveBeenCalledWith({ apiKey: 'test-key' }, 'test-slow')
    })

    it('should stream daemon stdout and stderr when daemon SSE is available', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-791', status: 'running' },
          sandboxId: 'test-791'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi
          .fn()
          .mockResolvedValueOnce({
            stdout: 'first',
            stderr: '',
            exitCode: 0,
            durationMs: 4
          } as CommandResult)
          .mockImplementationOnce(async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
            return {
              stdout: 'second',
              stderr: '',
              exitCode: 0,
              durationMs: 6
            } as CommandResult
          }),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-791',
          provider: 'mock',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-791-3000.mock.dev')
      }

      let latestRequestId = 'req_1'
      daemonSeedScriptCommand.mockImplementation((_config, payload: any) => {
        if (payload && typeof payload === 'object' && payload.requestId) {
          latestRequestId = payload.requestId
        }
        return 'node -e "seed" "echo hi"'
      })
      parseSeedInvocationOutput
        .mockImplementationOnce(() => ({
          token: 'tok',
          requestId: 'req_0',
          daemon: { reused: false, pid: 42, sseUrl: 'http://127.0.0.1:33937/events?token=tok' },
          command: {
            exitCode: 0,
            signal: null,
            stdout: '',
            stderr: '',
            combined: '',
          },
        }))
        .mockImplementationOnce(() => ({
          token: 'tok',
          requestId: latestRequestId,
          daemon: { reused: true, pid: 42, sseUrl: 'http://127.0.0.1:33937/events?token=tok' },
          command: {
            exitCode: 0,
            signal: null,
            stdout: 'final\n',
            stderr: 'final err\n',
            combined: 'final\nfinal err\n',
          },
        }))

      const encoder = new TextEncoder()
      const fetchMock = vi.fn().mockImplementation(async () => {
        const requestIdForThisStream = latestRequestId
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              const ssePayload = [
                `data: {"type":"command.stdout","requestId":"${requestIdForThisStream}","data":{"chunk":"chunk-a\\n"}}\n\n`,
                `data: {"type":"command.stderr","requestId":"${requestIdForThisStream}","data":{"chunk":"err-a\\n"}}\n\n`,
              ].join('')
              controller.enqueue(encoder.encode(ssePayload))
              controller.close()
            },
            cancel() {
              // noop
            },
          }),
        }
      })
      vi.stubGlobal('fetch', fetchMock as any)

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()

      const onStdout = vi.fn()
      const onStderr = vi.fn()
      await sandbox.runCommand('echo hi', {
        onStdout,
        onStderr,
      })

      expect(methods.getUrl).toHaveBeenCalledWith(
        { id: 'test-791', status: 'running' },
        { port: 33937 }
      )
      expect(fetchMock).toHaveBeenCalledWith('https://test-791-3000.mock.dev/events?token=tok', expect.any(Object))
      expect(onStdout).toHaveBeenCalledWith('chunk-a\n')
      expect(onStderr).toHaveBeenCalledWith('err-a\n')
    })
  })
})

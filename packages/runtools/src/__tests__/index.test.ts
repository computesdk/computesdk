import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  class MockRunToolsApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly payload: unknown = null,
    ) {
      super(message)
    }
  }

  return {
    constructors: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    destroy: vi.fn(),
    getUrl: vi.fn(),
    MockRunToolsApiError,
  }
})

vi.mock('@runtools-ai/sdk', () => ({
  RunToolsApiError: sdk.MockRunToolsApiError,
  RunTools: class MockRunTools {
    readonly sandbox = {
      create: sdk.create,
      get: sdk.get,
      list: sdk.list,
      destroy: sdk.destroy,
      getUrl: sdk.getUrl,
    }

    constructor(options: unknown) {
      sdk.constructors(options)
    }
  },
}))

import { mapStatus, parseFindOutput, resolveTemplate, runtools, shellQuote } from '../index'

function nativeSandbox(id = 'sandbox-test123') {
  const state = {
    sandboxId: id,
    agentId: 'agent-1',
    orgId: 'org-1',
    status: 'running',
    template: 'base-ubuntu',
    sshReady: true,
    vncReady: false,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: Date.now(),
  }
  return {
    id,
    state,
    refresh: vi.fn().mockResolvedValue(state),
    exec: vi.fn().mockResolvedValue({
      stdout: 'v22.0.0\n',
      stderr: '',
      exitCode: 0,
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RunTools provider', () => {
  it('maps ComputeSDK create options onto the public RunTools SDK', async () => {
    const native = nativeSandbox()
    sdk.create.mockResolvedValue(native)
    const provider = runtools({
      apiKey: 'rt_test_compute',
      apiUrl: 'https://api.example.test',
    })

    const sandbox = await provider.sandbox.create({
      name: 'benchmark',
      templateId: 'base-ubuntu',
      timeout: 120_000,
      envs: { BENCHMARK: '1' },
      vcpus: 1,
      memoryMb: 1024,
      diskMiB: 10_240,
    })

    expect(sdk.constructors).toHaveBeenCalledWith({
      apiKey: 'rt_test_compute',
      apiUrl: 'https://api.example.test',
    })
    expect(sdk.create).toHaveBeenCalledWith({
      template: 'base-ubuntu',
      name: 'benchmark',
      tags: undefined,
      sshKeys: undefined,
      rootPassword: undefined,
      resources: { vcpus: 1, memory: '1024MB', disk: '10GB' },
      env: { BENCHMARK: '1' },
      idleTimeout: 120,
    })
    expect(sandbox.sandboxId).toBe(native.id)
  })

  it('executes commands and synthesizes background mode', async () => {
    const native = nativeSandbox()
    sdk.create.mockResolvedValue(native)
    const sandbox = await runtools({ apiKey: 'rt_test_exec' }).sandbox.create()

    const result = await sandbox.runCommand('node -v', {
      cwd: '/workspace',
      env: { FOO: 'bar' },
      timeout: 20_000,
    })
    expect(native.exec).toHaveBeenCalledWith('node -v', {
      cwd: '/workspace',
      env: { HOME: '/root', FOO: 'bar' },
      timeout: 20_000,
    })
    expect(result).toMatchObject({ stdout: 'v22.0.0\n', exitCode: 0 })

    await sandbox.runCommand('sleep 5', { background: true })
    expect(native.exec.mock.calls[1]?.[0]).toContain("nohup sh -lc 'sleep 5'")
  })

  it('maps only genuine 404s to absent/idempotent lifecycle outcomes', async () => {
    const missing = nativeSandbox('missing')
    missing.refresh.mockRejectedValue(new sdk.MockRunToolsApiError('not found', 404))
    sdk.get.mockReturnValue(missing)

    const provider = runtools({ apiKey: 'rt_test_not_found' })
    await expect(provider.sandbox.getById('missing')).resolves.toBeNull()

    sdk.destroy.mockRejectedValueOnce(new sdk.MockRunToolsApiError('gone', 404))
    await expect(provider.sandbox.destroy('missing')).resolves.toBeUndefined()

    sdk.destroy.mockRejectedValueOnce(new sdk.MockRunToolsApiError('unavailable', 503))
    await expect(provider.sandbox.destroy('broken')).rejects.toThrow('unavailable')
  })

  it('lists native handles and uses the RunTools preview URL', async () => {
    const native = nativeSandbox('sandbox-list1')
    sdk.list.mockResolvedValue([{ id: native.id, status: 'running', createdAt: '2026-08-08T00:00:00Z' }])
    sdk.get.mockReturnValue(native)
    sdk.getUrl.mockResolvedValue({ url: 'https://sandbox-list1.preview.runtools.ai', port: 3000 })

    const [sandbox] = await runtools({ apiKey: 'rt_test_list' }).sandbox.list()
    expect(sandbox?.sandboxId).toBe(native.id)
    await expect(sandbox?.getUrl({ port: 3000, protocol: 'wss' }))
      .resolves.toBe('wss://sandbox-list1.preview.runtools.ai/')
  })
})

describe('pure helpers', () => {
  it('maps lifecycle status without reporting transitional states as ready', () => {
    expect(mapStatus('running')).toBe('running')
    expect(mapStatus('creating')).toBe('stopped')
    expect(mapStatus('failed')).toBe('error')
  })

  it('defaults ComputeSDK node/python runtimes to base-ubuntu', () => {
    expect(resolveTemplate({ runtime: 'node' }, {})).toBe('base-ubuntu')
    expect(resolveTemplate({ image: 'desktop-ubuntu' }, {})).toBe('desktop-ubuntu')
  })

  it('quotes shell tokens and parses NUL-delimited find output', () => {
    expect(shellQuote("a'b c")).toBe("'a'\\''b c'")
    const findOutput = [
      'one.txt', 'f', '3', '1723120000.5',
      'dir', 'd', '0', '1723120001',
      '',
    ].join('\0')
    expect(parseFindOutput(findOutput))
      .toEqual([
        { name: 'one.txt', type: 'file', size: 3, modified: new Date(1_723_120_000_500) },
        { name: 'dir', type: 'directory', size: 0, modified: new Date(1_723_120_001_000) },
      ])
  })
})

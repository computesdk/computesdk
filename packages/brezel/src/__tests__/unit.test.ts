import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class BrezelError extends Error {
    status: number

    constructor(message: string, status = 0) {
      super(message)
      this.status = status
    }
  }

  const state = {
    createGate: undefined as Promise<void> | undefined,
    createOptions: [] as Array<Record<string, unknown>>,
    deleted: new Set<string>(),
    runOptions: [] as Array<Record<string, unknown>>,
  }

  return { BrezelError, state }
})

vi.mock('@infercrane/brezel', () => {
  const makeSandbox = (id: string) => ({
    id,
    resource: {
      id,
      state: h.state.deleted.has(id) ? 'deleted' : 'running',
      created_at: '2026-09-18T00:00:00.000Z',
      environment_revision: 'envr_test',
      revision: 1,
    },
    run: vi.fn(async (_argv: string[], options: Record<string, unknown> = {}) => {
      h.state.runOptions.push(options)
      const onEvent = options.onEvent as ((event: Record<string, unknown>) => void) | undefined
      onEvent?.({ type: 'stdout', data: Buffer.from('ok\n').toString('base64') })
      return {
        stdoutText: 'ok\n',
        stderrText: '',
        exitCode: 0,
      }
    }),
    delete: vi.fn(async () => {
      h.state.deleted.add(id)
      return { id, state: 'deleted' }
    }),
    preview: vi.fn(async () => 'https://preview.example'),
    readFile: vi.fn(async () => new TextEncoder().encode('file')),
    writeFile: vi.fn(async () => ({})),
  })

  class BrezelClient {
    async createSandbox(options: Record<string, unknown>) {
      h.state.createOptions.push(options)
      await h.state.createGate
      return makeSandbox('sb_new')
    }

    async sandbox(id: string) {
      return makeSandbox(id)
    }

    async listSandboxes() {
      return []
    }
  }

  return {
    BrezelClient,
    BrezelError: h.BrezelError,
    Sandbox: class Sandbox {},
  }
})

import { brezel } from '../index'

function provider() {
  return brezel({
    apiKey: 'test-token',
    baseUrl: 'https://brezel.example',
    project: 'test-project',
    environmentRevision: 'envr_test',
  })
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  h.state.createGate = undefined
  h.state.createOptions = []
  h.state.deleted.clear()
  h.state.runOptions = []
})

describe('Brezel provider lifecycle boundaries', () => {
  it('rejects invalid create-time environment names before provisioning', async () => {
    await expect(
      provider().sandbox.create({ envs: { 'INVALID-NAME': 'value' } }),
    ).rejects.toThrow(/Invalid environment variable name/)
    expect(h.state.createOptions).toHaveLength(0)
  })

  it('rejects create-time environments instead of losing them on reconnect', async () => {
    await expect(
      provider().sandbox.create({ envs: { NODE_ENV: 'production' } }),
    ).rejects.toThrow(/does not support durable create-time envs/)
    expect(h.state.createOptions).toHaveLength(0)
  })

  it('clamps short sandbox lifetimes to Brezel minimum', async () => {
    const sandbox = await provider().sandbox.create({ timeout: 5_000 })
    expect(h.state.createOptions).toEqual([
      expect.objectContaining({ ttlSeconds: 30 }),
    ])
    expect((await sandbox.getInfo()).timeout).toBe(5_000)
  })

  it('rejects lifetimes above Brezel maximum before provisioning', async () => {
    await expect(
      provider().sandbox.create({ timeout: 2_592_000_001 }),
    ).rejects.toThrow(/cannot exceed.*30 days/)
    expect(h.state.createOptions).toHaveLength(0)
  })

  it('lets the ComputeSDK factory clean up a sandbox created after abort', async () => {
    const gate = deferred()
    h.state.createGate = gate.promise
    const controller = new AbortController()
    const creation = provider().sandbox.create({ signal: controller.signal })
    await vi.waitFor(() => expect(h.state.createOptions).toHaveLength(1))

    controller.abort()
    await expect(creation).rejects.toMatchObject({ name: 'AbortError' })
    gate.resolve()

    await vi.waitFor(() => expect(h.state.deleted.has('sb_new')).toBe(true))
  })

  it('applies command environments to reconnected sandboxes', async () => {
    const sandbox = await provider().sandbox.getById('sb_existing')
    expect(sandbox).not.toBeNull()

    await sandbox?.runCommand('echo "$NODE_ENV"', {
      env: { NODE_ENV: 'production' },
    })
    expect(h.state.runOptions).toEqual([
      expect.objectContaining({ env: { NODE_ENV: 'production' } }),
    ])
  })

  it('uses Brezel native command streaming for output callbacks', async () => {
    const sandbox = await provider().sandbox.getById('sb_existing')
    const chunks: string[] = []

    const result = await sandbox?.runCommand('printf ok', {
      onStdout: chunk => chunks.push(chunk),
    })

    expect(chunks.join('')).toBe('ok\n')
    expect(result?.stdout).toBe('ok\n')
  })

  it('rejects invalid command timeouts before contacting Brezel', async () => {
    const sandbox = await provider().sandbox.getById('sb_existing')

    await expect(
      sandbox?.runCommand('true', { timeout: Number.NaN }),
    ).rejects.toThrow(/positive finite number/)
    expect(h.state.runOptions).toHaveLength(0)
  })
})

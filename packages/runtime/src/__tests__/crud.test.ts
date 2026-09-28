import { afterAll, describe, expect, it } from 'vitest'
import { runtime } from '../index'

const provider = runtime({
  apiKey: process.env.RUNTIME_API_KEY,
  baseUrl: process.env.RUNTIME_API_URL,
})

describe.skipIf(!process.env.RUNTIME_API_KEY)('Runtime provider CRUD integration', () => {
  let sandboxId: string | undefined
  let destroyed = false

  afterAll(async () => {
    if (sandboxId && !destroyed) await provider.sandbox.destroy(sandboxId)
  })

  it('creates, reconnects, lists, and confirms the sandbox is gone after destroy', async () => {
    const created = await provider.sandbox.create()
    sandboxId = created.sandboxId
    expect(sandboxId).toBeTruthy()

    const reconnected = await provider.sandbox.getById(sandboxId)
    expect(reconnected?.sandboxId).toBe(sandboxId)

    const listed = await provider.sandbox.list()
    expect(listed.some((sandbox) => sandbox.sandboxId === sandboxId)).toBe(true)

    await provider.sandbox.destroy(sandboxId)
    destroyed = true
    await expect(provider.sandbox.getById(sandboxId)).resolves.toBeNull()

    const after = await provider.sandbox.list()
    expect(after.some((sandbox) => sandbox.sandboxId === sandboxId)).toBe(false)
  }, 180_000)

  it('applies create-time envs to every command', async () => {
    const created = await provider.sandbox.create({ envs: { COMPUTESDK_PROBE: 'from-create' } })
    try {
      const result = await created.runCommand('printf %s "$COMPUTESDK_PROBE"')
      expect(result.stdout).toBe('from-create')
      const override = await created.runCommand('printf %s "$COMPUTESDK_PROBE"', {
        env: { COMPUTESDK_PROBE: 'from-command' },
      })
      expect(override.stdout).toBe('from-command')
    } finally {
      await created.destroy()
    }
  }, 180_000)
})

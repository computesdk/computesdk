import { afterAll, describe, expect, it } from 'vitest'
import { brezel } from '../index'

const hasCredentials = Boolean(
  process.env.BREZEL_API_KEY &&
  process.env.BREZEL_API_URL &&
  process.env.BREZEL_PROJECT_ID &&
  process.env.BREZEL_ENVIRONMENT_REVISION,
)

const provider = brezel({
  baseUrl: process.env.BREZEL_API_URL,
  apiKey: process.env.BREZEL_API_KEY,
  project: process.env.BREZEL_PROJECT_ID,
  environmentRevision: process.env.BREZEL_ENVIRONMENT_REVISION,
  allowInternet: process.env.BREZEL_ALLOW_INTERNET === 'true',
})

describe.skipIf(!hasCredentials)('Brezel provider CRUD integration', () => {
  let sandboxId: string | undefined
  let destroyed = false

  afterAll(async () => {
    if (sandboxId && !destroyed) await provider.sandbox.destroy(sandboxId)
  })

  it('creates, reconnects, lists, and confirms sandbox deletion', async () => {
    const created = await provider.sandbox.create()
    sandboxId = created.sandboxId
    expect(sandboxId).toBeTruthy()

    const reconnected = await provider.sandbox.getById(sandboxId)
    expect(reconnected?.sandboxId).toBe(sandboxId)

    const listed = await provider.sandbox.list()
    expect(listed.some(sandbox => sandbox.sandboxId === sandboxId)).toBe(true)

    await provider.sandbox.destroy(sandboxId)
    destroyed = true
    await expect(provider.sandbox.getById(sandboxId)).resolves.toBeNull()
  }, 120_000)
})

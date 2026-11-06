import { describe, expect, it } from 'vitest'
import { runProviderTestSuite } from '@computesdk/test-utils'
import { isorun } from '../index'

runProviderTestSuite({
  name: 'isorun',
  provider: isorun({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  ports: [3000, 8080],
  skipIntegration: !process.env.ISORUN_API_KEY,
  supportsPauseResume: true,
  supportsSnapshots: true,
})

describe('isorun lifecycle capabilities', () => {
  it('declares pause/resume and snapshot capabilities', () => {
    const provider = isorun({})
    expect(provider.sandbox.pause).toEqual({ memory: true })
    expect(provider.snapshot?.capabilities).toEqual({ scope: 'rootfs', memory: true, destroysSource: false })
  })
})

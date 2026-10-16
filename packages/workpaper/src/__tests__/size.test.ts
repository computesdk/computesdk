import { describe, expect, it } from 'vitest'
import { sizeFor } from '../index'

describe('sizeFor', () => {
  it('picks the smallest size that fits', () => {
    expect(sizeFor({})).toBe('small')
    expect(sizeFor({ size: 'xlarge' })).toBe('xlarge')
    expect(sizeFor({}, { vcpus: 3 })).toBe('large')
    expect(sizeFor({}, { memMiB: 16384 })).toBe('xlarge')
  })

  it('refuses requests larger than the largest size', () => {
    expect(() => sizeFor({}, { vcpus: 16 })).toThrow(/up to 8 vCPUs/)
    expect(() => sizeFor({}, { memMiB: 32768 })).toThrow(/16384 MiB/)
  })
})

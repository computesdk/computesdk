import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ComputeSDK } from '../sdk'
import { ConfigurationError } from '../errors'

// Mock the dynamic imports
vi.mock('@computesdk/e2b', () => ({
  e2b: vi.fn(() => ({
    provider: 'e2b',
    sandboxId: 'e2b-123',
    execute: vi.fn(),
    kill: vi.fn(),
    getInfo: vi.fn()
  }))
}))

vi.mock('@computesdk/vercel', () => ({
  vercel: vi.fn(() => ({
    provider: 'vercel',
    sandboxId: 'vercel-123',
    execute: vi.fn(),
    kill: vi.fn(),
    getInfo: vi.fn()
  }))
}))

describe('ComputeSDK', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  describe('createSandbox', () => {
    it('should create sandbox with auto-detection', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      
      const sandbox = ComputeSDK.createSandbox()
      
      expect(sandbox.provider).toBe('e2b')
    })

    it('should create sandbox with explicit provider', () => {
      const sandbox = ComputeSDK.createSandbox({ provider: 'vercel' })
      
      expect(sandbox.provider).toBe('vercel')
    })

    it('should throw error when no provider available for auto', () => {
      expect(() => ComputeSDK.createSandbox()).toThrow(
        'No providers available. Please set one of the following environment variables'
      )
    })

    it('should throw error for unknown provider', () => {
      expect(() => ComputeSDK.createSandbox({ provider: 'unknown' as any }))
        .toThrow("Provider 'unknown' not installed")
    })

    it('should pass configuration to provider', () => {
      const sandbox = ComputeSDK.createSandbox({ 
        provider: 'e2b',
        runtime: 'python',
        timeout: 60000
      })
      
      expect(sandbox.provider).toBe('e2b')
    })
  })

  describe('detectProviders', () => {
    it('should detect available providers', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      
      const providers = ComputeSDK.detectProviders()
      
      expect(providers).toContain('e2b')
      expect(providers).toContain('vercel')
    })

    it('should return empty array when no providers', () => {
      const providers = ComputeSDK.detectProviders()
      
      expect(providers).toHaveLength(0)
    })
  })
})
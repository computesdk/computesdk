import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ENV_KEYS,
  DEFAULT_TIMEOUT,
  normalizeSandboxConfig,
  detectAvailableProviders,
  autoSelectProvider
} from '../config'

describe('Configuration', () => {
  beforeEach(() => {
    // Clear all environment variables before each test
    vi.unstubAllEnvs()
  })

  describe('normalizeSandboxConfig', () => {
    it('should use defaults when no config provided', () => {
      const config = normalizeSandboxConfig()
      
      expect(config.provider).toBe('auto')
      expect(config.timeout).toBe(DEFAULT_TIMEOUT)
      expect(config.runtime).toBeUndefined()
      expect(config.container).toBeUndefined()
    })

    it('should merge provided config with defaults', () => {
      const config = normalizeSandboxConfig({
        provider: 'e2b',
        runtime: 'python'
      })
      
      expect(config.provider).toBe('e2b')
      expect(config.runtime).toBe('python')
      expect(config.timeout).toBe(DEFAULT_TIMEOUT)
    })

    it('should auto-select provider when provider is auto', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      
      const config = normalizeSandboxConfig({ provider: 'auto' })
      
      expect(config.provider).toBe('e2b')
    })

    it('should keep explicit provider even if auto-selection would differ', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      
      const config = normalizeSandboxConfig({ provider: 'vercel' })
      
      expect(config.provider).toBe('vercel')
    })
  })

  describe('detectAvailableProviders', () => {
    it('should detect E2B when API key is set', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toContain('e2b')
      expect(providers).not.toContain('vercel')
      expect(providers).not.toContain('cloudflare')
      expect(providers).not.toContain('fly')
    })

    it('should detect Vercel when token is set', () => {
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toContain('vercel')
      expect(providers).not.toContain('e2b')
    })

    it('should detect Cloudflare when both tokens are set', () => {
      vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token')
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'test-account')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toContain('cloudflare')
    })

    it('should not detect Cloudflare with only API token', () => {
      vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token')
      
      const providers = detectAvailableProviders()
      
      expect(providers).not.toContain('cloudflare')
    })

    it('should detect Fly.io when token is set', () => {
      vi.stubEnv('FLY_API_TOKEN', 'test-token')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toContain('fly')
    })

    it('should detect multiple providers', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      vi.stubEnv('FLY_API_TOKEN', 'test-token')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toHaveLength(3)
      expect(providers).toContain('e2b')
      expect(providers).toContain('vercel')
      expect(providers).toContain('fly')
    })

    it('should return empty array when no providers available', () => {
      const providers = detectAvailableProviders()
      
      expect(providers).toHaveLength(0)
    })
  })

  describe('autoSelectProvider', () => {
    it('should select first available provider', () => {
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      vi.stubEnv('FLY_API_TOKEN', 'test-token')
      
      const provider = autoSelectProvider()
      
      // Should select first in priority order
      expect(provider).toBe('vercel')
    })

    it('should respect provider priority order', () => {
      // Set all providers
      vi.stubEnv('E2B_API_KEY', 'test-key')
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token')
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'test-account')
      vi.stubEnv('FLY_API_TOKEN', 'test-token')
      
      const provider = autoSelectProvider()
      
      // E2B should be selected first based on priority
      expect(provider).toBe('e2b')
    })

    it('should return null when no providers available', () => {
      const provider = autoSelectProvider()
      
      expect(provider).toBeNull()
    })
  })
})
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
      vi.stubEnv('E2B_API_KEY', 'test-key')
      
      const config = normalizeSandboxConfig()
      
      expect(config.provider).toBe('e2b')
      expect(config.timeout).toBe(DEFAULT_TIMEOUT)
      expect(config.runtime).toBe('python')
      expect(config.container).toBeUndefined()
    })

    it('should merge provided config with defaults', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      
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
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      
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
      expect(providers).not.toContain('daytona')
      expect(providers).not.toContain('fly')
    })

    it('should detect Vercel when token is set', () => {
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toContain('vercel')
      expect(providers).not.toContain('e2b')
    })

    it('should detect Daytona when API key is set', () => {
      vi.stubEnv('DAYTONA_API_KEY', 'test-key')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toContain('daytona')
    })

    it('should detect multiple providers', () => {
      vi.stubEnv('E2B_API_KEY', 'test-key')
      vi.stubEnv('VERCEL_TOKEN', 'test-token')
      vi.stubEnv('DAYTONA_API_KEY', 'test-daytona-key')
      
      const providers = detectAvailableProviders()
      
      expect(providers).toHaveLength(3)
      expect(providers).toContain('e2b')
      expect(providers).toContain('vercel')
      expect(providers).toContain('daytona')
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

    it('should return undefined when no providers available', () => {
      const provider = autoSelectProvider()
      
      expect(provider).toBeUndefined()
    })
  })
})
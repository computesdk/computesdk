import { describe, it, expect, vi } from 'vitest'
import { createComputeRegistry } from '../registry'
import type { ComputeSandbox, ProviderFactory } from '../types'

describe('Registry', () => {
  const createMockSandbox = (provider: string): ComputeSandbox => ({
    provider,
    sandboxId: `${provider}-123`,
    execute: vi.fn(),
    runCode: vi.fn(),
    runCommand: vi.fn(),
    kill: vi.fn(),
    getInfo: vi.fn()
  })

  const mockProviders = {
    e2b: vi.fn(() => createMockSandbox('e2b')) as ProviderFactory,
    vercel: vi.fn(() => createMockSandbox('vercel')) as ProviderFactory,
    daytona: vi.fn(() => createMockSandbox('daytona')) as ProviderFactory
  }

  describe('createComputeRegistry', () => {
    it('should create registry with providers', () => {
      const registry = createComputeRegistry(mockProviders)
      
      expect(registry).toBeDefined()
      expect(registry.sandbox).toBeDefined()
    })

    it('should throw error for empty providers', () => {
      expect(() => createComputeRegistry({})).toThrow('Provider registry requires at least one provider')
    })
  })

  describe('sandbox method', () => {
    it('should create sandbox with provider name only', () => {
      const registry = createComputeRegistry(mockProviders)
      
      const sandbox = registry.sandbox('e2b')
      
      expect(sandbox.provider).toBe('e2b')
      expect(mockProviders.e2b).toHaveBeenCalledWith()
    })

    it('should create sandbox with provider and runtime', () => {
      const registry = createComputeRegistry(mockProviders)
      
      const sandbox = registry.sandbox('vercel:node')
      
      expect(sandbox.provider).toBe('vercel')
      expect(mockProviders.vercel).toHaveBeenCalledWith({ runtime: 'node' })
    })

    it('should create sandbox with provider and container image', () => {
      const registry = createComputeRegistry(mockProviders)
      
      const sandbox = registry.sandbox('daytona:python:3.11')
      
      expect(sandbox.provider).toBe('daytona')
      expect(mockProviders.daytona).toHaveBeenCalledWith({ 
        container: { image: 'python:3.11' }
      })
    })

    it('should throw error for unknown provider', () => {
      const registry = createComputeRegistry(mockProviders)
      
      expect(() => registry.sandbox('unknown')).toThrow('Provider \'unknown\' not found in registry')
    })

    it('should throw error for invalid sandbox ID format', () => {
      const registry = createComputeRegistry(mockProviders)
      
      expect(() => registry.sandbox('')).toThrow('Provider \'\' not found in registry')
    })

    it('should handle provider with multiple colons', () => {
      const registry = createComputeRegistry(mockProviders)
      
      const sandbox = registry.sandbox('daytona:ubuntu:22.04')
      
      expect(sandbox.provider).toBe('daytona')
      expect(mockProviders.daytona).toHaveBeenCalledWith({ 
        container: { image: 'ubuntu:22.04' }
      })
    })
  })
})
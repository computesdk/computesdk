import { describe, it, expect } from 'vitest'
import {
  ComputeError,
  ExecutionError,
  TimeoutError,
  ProviderError,
  ConfigurationError,
  AuthenticationError,
  ProviderUnavailableError
} from '../errors'

describe('Error Classes', () => {
  describe('ExecutionError', () => {
    it('should create execution error with correct properties', () => {
      const error = new ExecutionError('Code execution failed', 'e2b', 1, 'sandbox-123')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.message).toBe('Code execution failed')
      expect(error.code).toBe('EXECUTION_ERROR')
      expect(error.provider).toBe('e2b')
      expect(error.sandboxId).toBe('sandbox-123')
      expect(error.exitCode).toBe(1)
      expect(error.isRetryable).toBe(false)
    })
  })

  describe('TimeoutError', () => {
    it('should create timeout error with correct properties', () => {
      const error = new TimeoutError('Execution timed out', 'vercel', 5000, 'sandbox-456')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('TIMEOUT_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.provider).toBe('vercel')
      expect(error.sandboxId).toBe('sandbox-456')
      expect(error.timeoutMs).toBe(5000)
    })
  })

  describe('ProviderError', () => {
    it('should create provider error with cause', () => {
      const cause = new Error('Network error')
      const error = new ProviderError('Provider request failed', 'cloudflare', cause, 'sandbox-789')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('PROVIDER_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.sandboxId).toBe('sandbox-789')
      expect(error.originalError).toBe(cause)
    })
  })

  describe('ConfigurationError', () => {
    it('should create configuration error', () => {
      const error = new ConfigurationError('Invalid runtime specified', 'fly')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('CONFIGURATION_ERROR')
      expect(error.isRetryable).toBe(false)
    })
  })

  describe('AuthenticationError', () => {
    it('should create authentication error', () => {
      const error = new AuthenticationError('Invalid API key', 'e2b')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('AUTHENTICATION_ERROR')
      expect(error.isRetryable).toBe(false)
    })
  })

  describe('ProviderUnavailableError', () => {
    it('should create provider unavailable error', () => {
      const error = new ProviderUnavailableError('No providers available', 'auto')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('PROVIDER_UNAVAILABLE')
      expect(error.isRetryable).toBe(true)
    })
  })
})
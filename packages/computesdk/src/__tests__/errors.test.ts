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
      const error = new ExecutionError('Code execution failed', 'e2b', 'sandbox-123')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.message).toBe('Code execution failed')
      expect(error.code).toBe('EXECUTION_ERROR')
      expect(error.provider).toBe('e2b')
      expect(error.sandboxId).toBe('sandbox-123')
      expect(error.isRetryable).toBe(false)
    })
  })

  describe('TimeoutError', () => {
    it('should create timeout error with correct properties', () => {
      const error = new TimeoutError('Execution timed out', 'vercel', 'sandbox-456')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('TIMEOUT_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.provider).toBe('vercel')
    })
  })

  describe('ProviderError', () => {
    it('should create provider error with cause', () => {
      const cause = new Error('Network error')
      const error = new ProviderError('Provider request failed', 'cloudflare', cause, 'sandbox-789')
      
      expect(error).toBeInstanceOf(ComputeError)
      expect(error.code).toBe('PROVIDER_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.cause).toBe(cause)
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
      expect(error.isRetryable).toBe(false)
    })
  })
})
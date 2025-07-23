import { describe, it, expect } from 'vitest'
import { validateCode, validateRuntime, validateExecutionOptions } from '../src/utils/validation.js'

describe('validation utilities', () => {
  describe('validateCode', () => {
    it('should validate empty code', () => {
      const result = validateCode('')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Code cannot be empty')
    })

    it('should validate whitespace-only code', () => {
      const result = validateCode('   \n\t  ')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Code cannot be empty')
    })

    it('should validate valid code', () => {
      const result = validateCode('print("hello")')
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate code length limits', () => {
      const longCode = 'x'.repeat(50001)
      const result = validateCode(longCode)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Code is too long (maximum 50,000 characters)')
    })
  })

  describe('validateRuntime', () => {
    it('should validate supported runtimes', () => {
      expect(validateRuntime('python').isValid).toBe(true)
      expect(validateRuntime('javascript').isValid).toBe(true)
    })

    it('should reject unsupported runtimes', () => {
      const result = validateRuntime('ruby' as any)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Runtime must be one of: python, javascript')
    })

    it('should reject null/undefined runtime', () => {
      const result = validateRuntime(null as any)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Runtime is required and must be a string')
    })
  })

  describe('validateExecutionOptions', () => {
    it('should validate default options', () => {
      const result = validateExecutionOptions({})
      expect(result.isValid).toBe(true)
    })

    it('should validate timeout limits', () => {
      const result = validateExecutionOptions({ timeout: 600001 })
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Timeout cannot exceed 600000ms (10 minutes)')
    })

    it('should validate negative timeout', () => {
      const result = validateExecutionOptions({ timeout: -1 })
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Timeout must be positive')
    })

    it('should validate retry limits', () => {
      const result = validateExecutionOptions({ retries: 6 })
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Retries cannot exceed 5')
    })

    it('should validate negative retries', () => {
      const result = validateExecutionOptions({ retries: -1 })
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Retries must be non-negative')
    })
  })
})
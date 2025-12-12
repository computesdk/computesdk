import { describe, it, expect } from 'vitest';
import { lambda, getAndValidateCredentials } from '../index';

describe('Lambda Provider', () => {
  describe('Provider factory', () => {
    it('should create a lambda provider instance', () => {
      const provider = lambda({
        apiKey: 'test-key',
        regionName: 'us-west-1',
        instanceTypeName: 'gpu_1x_a10',
        sshKeyName: 'test-key'
      });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('lambda');
      expect(typeof provider.sandbox.create).toBe('function');
      expect(typeof provider.sandbox.destroy).toBe('function');
      expect(typeof provider.sandbox.list).toBe('function');
      expect(typeof provider.sandbox.getById).toBe('function');
    });

    it('should have correct provider properties', () => {
      const provider = lambda({
        apiKey: 'test-key',
        regionName: 'us-west-1',
        instanceTypeName: 'gpu_1x_a10',
        sshKeyName: 'test-key'
      });

      expect(provider.name).toBe('lambda');
      expect(typeof provider.getSupportedRuntimes).toBe('function');
    });
  });

  describe('Configuration validation', () => {
    it('should validate complete configuration', () => {
      const config = {
        apiKey: 'test-api-key',
        regionName: 'us-west-1',
        instanceTypeName: 'gpu_1x_a10',
        sshKeyName: 'test-ssh-key'
      };

      const result = getAndValidateCredentials(config);
      
      expect(result.apiKey).toBe('test-api-key');
      expect(result.regionName).toBe('us-west-1');
      expect(result.instanceTypeName).toBe('gpu_1x_a10');
      expect(result.sshKeyName).toBe('test-ssh-key');
    });

    it('should throw error for missing API key', () => {
      const config = {
        regionName: 'us-west-1',
        instanceTypeName: 'gpu_1x_a10',
        sshKeyName: 'test-ssh-key'
      };

      expect(() => getAndValidateCredentials(config)).toThrow('Missing Lambda API key');
    });

    it('should throw error for missing region name', () => {
      const config = {
        apiKey: 'test-api-key',
        instanceTypeName: 'gpu_1x_a10',
        sshKeyName: 'test-ssh-key'
      };

      expect(() => getAndValidateCredentials(config)).toThrow('Missing Lambda Region Name');
    });

    it('should throw error for missing instance type', () => {
      const config = {
        apiKey: 'test-api-key',
        regionName: 'us-west-1',
        sshKeyName: 'test-ssh-key'
      };

      expect(() => getAndValidateCredentials(config)).toThrow('Missing Lambda Instance Type Name');
    });

    it('should throw error for missing SSH key name', () => {
      const config = {
        apiKey: 'test-api-key',
        regionName: 'us-west-1',
        instanceTypeName: 'gpu_1x_a10'
      };

      expect(() => getAndValidateCredentials(config)).toThrow('Missing Lambda SSH Key Name');
    });
  });

  describe('Error handling', () => {
    it('should handle configuration errors gracefully', () => {
      expect(() => lambda({})).not.toThrow(); // Provider creation should not throw
      
      const provider = lambda({});
      
      // The error should be thrown when attempting to use the provider methods
      expect(async () => {
        await provider.sandbox.create();
      }).rejects.toThrow();
    });
  });
});
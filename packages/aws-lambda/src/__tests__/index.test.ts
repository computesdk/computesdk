import { describe, it, expect } from 'vitest';
import { awsLambda, getAndValidateCredentials } from '../index';

describe('AWS Lambda Provider', () => {
  describe('Provider factory', () => {
    it('should create an aws-lambda provider instance', () => {
      const provider = awsLambda({
        roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
        region: 'us-east-2',
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key'
      });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('aws-lambda');
      expect(typeof provider.sandbox.create).toBe('function');
      expect(typeof provider.sandbox.destroy).toBe('function');
      expect(typeof provider.sandbox.list).toBe('function');
      expect(typeof provider.sandbox.getById).toBe('function');
    });

    it('should have correct provider properties', () => {
      const provider = awsLambda({
        roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
        region: 'us-east-2',
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key'
      });

      expect(provider.name).toBe('aws-lambda');
      expect(typeof provider.getSupportedRuntimes).toBe('function');
    });
  });

  describe('Configuration validation', () => {
    it('should validate complete configuration', () => {
      const config = {
        roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
        region: 'us-west-2',
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key',
        functionNamePrefix: 'test-prefix'
      };

      const result = getAndValidateCredentials(config);
      
      expect(result.roleArn).toBe('arn:aws:iam::123456789012:role/lambda-execution-role');
      expect(result.region).toBe('us-west-2');
      expect(result.functionNamePrefix).toBe('test-prefix');
      expect(result.credentials).toEqual({
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key'
      });
    });

    it('should throw error for missing IAM role ARN', () => {
      const config = {
        region: 'us-east-2',
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key'
      };

      expect(() => getAndValidateCredentials(config)).toThrow('Missing Lambda IAM Role ARN');
    });

    it('should use default region when not provided', () => {
      const config = {
        roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key'
      };

      const result = getAndValidateCredentials(config);
      
      expect(result.region).toBe('us-east-2');
    });

    it('should use default function name prefix when not provided', () => {
      const config = {
        roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
        accessKeyId: 'test-access-key-id',
        secretAccessKey: 'test-secret-access-key'
      };

      const result = getAndValidateCredentials(config);
      
      expect(result.functionNamePrefix).toBe('computesdk');
    });

    it('should handle missing credentials gracefully', () => {
      const config = {
        roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
        region: 'us-east-2'
      };

      const result = getAndValidateCredentials(config);
      
      expect(result.credentials).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('should handle configuration errors gracefully', () => {
      expect(() => awsLambda({})).not.toThrow(); // Provider creation should not throw
      
      const provider = awsLambda({});
      
      // The error should be thrown when attempting to use the provider methods
      expect(async () => {
        await provider.sandbox.create();
      }).rejects.toThrow();
    });
  });
});

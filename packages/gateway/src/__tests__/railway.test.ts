import { describe, it, expect, vi, beforeEach } from 'vitest';
import { railway, getAndValidateCredentials, fetchRailway } from '../railway';

describe('Railway Gateway Provider', () => {
  describe('getAndValidateCredentials', () => {
    it('should return credentials when all are provided', () => {
      const config = {
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
        environmentId: 'test-env-id',
      };

      const result = getAndValidateCredentials(config);

      expect(result).toEqual({
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
        environmentId: 'test-env-id',
      });
    });

    it('should throw error when apiKey is missing', () => {
      const config = {
        projectId: 'test-project-id',
        environmentId: 'test-env-id',
      };

      expect(() => getAndValidateCredentials(config)).toThrow(
        'Missing Railway API key'
      );
    });

    it('should throw error when projectId is missing', () => {
      const config = {
        apiKey: 'test-api-key',
        environmentId: 'test-env-id',
      };

      expect(() => getAndValidateCredentials(config)).toThrow(
        'Missing Railway Project ID'
      );
    });

    it('should throw error when environmentId is missing', () => {
      const config = {
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
      };

      expect(() => getAndValidateCredentials(config)).toThrow(
        'Missing Railway Environment ID'
      );
    });
  });

  describe('railway provider factory', () => {
    it('should create a provider with all required methods', () => {
      const provider = railway({
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
        environmentId: 'test-env-id',
      });

      expect(provider).toHaveProperty('name', 'railway');
      expect(provider).toHaveProperty('create');
      expect(provider).toHaveProperty('destroy');
      expect(provider).toHaveProperty('getById');
      expect(provider).toHaveProperty('list');
      expect(typeof provider.create).toBe('function');
      expect(typeof provider.destroy).toBe('function');
      expect(typeof provider.getById).toBe('function');
      expect(typeof provider.list).toBe('function');
    });
  });

  describe('fetchRailway', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should throw on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(
        fetchRailway('bad-key', { query: 'test' })
      ).rejects.toThrow('Railway API error: 401 Unauthorized');
    });

    it('should throw on GraphQL errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          errors: [{ message: 'Invalid query' }],
        }),
      });

      await expect(
        fetchRailway('test-key', { query: 'test' })
      ).rejects.toThrow('Railway GraphQL error: Invalid query');
    });

    it('should return data on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: { serviceCreate: { id: 'svc-123', name: 'test' } },
        }),
      });

      const result = await fetchRailway('test-key', { query: 'test' });

      expect(result).toEqual({ serviceCreate: { id: 'svc-123', name: 'test' } });
    });
  });
});

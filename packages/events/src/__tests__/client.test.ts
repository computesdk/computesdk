import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventsClient } from '../client';
import { EventsAuthError, EventsError, EventsNetworkError } from '../errors';

describe('EventsClient', () => {
  const originalFetch = global.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    // Ensure env vars don't leak between tests
    vi.stubEnv('COMPUTESDK_API_KEY', '');
    vi.stubEnv('COMPUTESDK_ACCESS_TOKEN', '');
    vi.stubEnv('COMPUTESDK_GATEWAY_URL', '');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe('storeEvent', () => {
    it('should store an event successfully', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
        accessToken: 'test-token',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            eventId: 'evt_123',
            sandboxId: 'sb_456',
            type: 'execution.started',
            timestamp: 1638360000000,
          },
        }),
      });

      const result = await client.storeEvent({
        type: 'execution.started',
        data: { command: 'npm start' },
      });

      expect(result.eventId).toBe('evt_123');
      expect(result.type).toBe('execution.started');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://events.computesdk.com/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should throw EventsAuthError when no access token', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
      });

      await expect(
        client.storeEvent({ type: 'test' })
      ).rejects.toThrow(EventsAuthError);
    });

    it('should throw EventsAuthError on 401 response', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
        accessToken: 'invalid-token',
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid token',
      });

      await expect(
        client.storeEvent({ type: 'test' })
      ).rejects.toThrow(EventsAuthError);
    });
  });

  describe('getEvents', () => {
    it('should get events successfully', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
        apiKey: 'test-api-key',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sandboxId: 'sb_456',
            events: [
              {
                id: 'evt_123',
                sandboxId: 'sb_456',
                workspaceId: 1,
                type: 'execution.started',
                data: {},
                timestamp: 1638360000000,
              },
            ],
            count: 1,
          },
        }),
      });

      const events = await client.getEvents('sb_456');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt_123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://events.computesdk.com/events/sb_456',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
          }),
        })
      );
    });

    it('should include query parameters', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
        apiKey: 'test-api-key',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { sandboxId: 'sb_456', events: [], count: 0 },
        }),
      });

      await client.getEvents('sb_456', {
        type: 'execution.started',
        since: 1638360000000,
        limit: 50,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('type=execution.started'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since=1638360000000'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object)
      );
    });

    it('should throw EventsAuthError when no API key', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
      });

      await expect(client.getEvents('sb_456')).rejects.toThrow(EventsAuthError);
    });
  });

  describe('setApiKey / setAccessToken', () => {
    it('should update API key', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
      });

      client.setApiKey('new-api-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { sandboxId: 'sb_456', events: [], count: 0 },
        }),
      });

      await client.getEvents('sb_456');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'new-api-key',
          }),
        })
      );
    });

    it('should update access token', async () => {
      const client = new EventsClient({
        gatewayUrl: 'https://events.computesdk.com',
      });

      client.setAccessToken('new-token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            eventId: 'evt_123',
            sandboxId: 'sb_456',
            type: 'test',
            timestamp: Date.now(),
          },
        }),
      });

      await client.storeEvent({ type: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer new-token',
          }),
        })
      );
    });
  });
});

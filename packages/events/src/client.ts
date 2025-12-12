import type {
  EventsClientConfig,
  GetEventsOptions,
  SandboxEvent,
  StoreEventOptions,
  StoreEventResult,
} from './types';
import { EventsAuthError, EventsError, EventsNetworkError } from './errors';
import { DEFAULT_GATEWAY_URL, DEFAULT_TIMEOUT } from './constants';

/**
 * HTTP client for storing and retrieving events
 */
export class EventsClient {
  private gatewayUrl: string;
  private apiKey?: string;
  private accessToken?: string;
  private timeout: number;

  constructor(config: EventsClientConfig = {}) {
    this.gatewayUrl =
      config.gatewayUrl ||
      process.env.COMPUTESDK_GATEWAY_URL ||
      DEFAULT_GATEWAY_URL;
    this.apiKey = config.apiKey || process.env.COMPUTESDK_API_KEY;
    this.accessToken =
      config.accessToken || process.env.COMPUTESDK_ACCESS_TOKEN;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Store an event (requires access token)
   * Used by compute daemons inside sandboxes
   */
  async storeEvent(options: StoreEventOptions): Promise<StoreEventResult> {
    if (!this.accessToken) {
      throw new EventsAuthError(
        'Access token required for storing events. Set accessToken in config or COMPUTESDK_ACCESS_TOKEN env var.'
      );
    }

    const response = await this.fetch('/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        type: options.type,
        data: options.data || {},
      }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const result = (await response.json()) as {
      success: boolean;
      data: StoreEventResult;
    };

    if (!result.success || !result.data) {
      throw new EventsError('Invalid response from server', response.status);
    }

    return result.data;
  }

  /**
   * Get events for a sandbox (requires API key)
   * Used by users to retrieve historical events
   */
  async getEvents(
    sandboxId: string,
    options: GetEventsOptions = {}
  ): Promise<SandboxEvent[]> {
    if (!this.apiKey) {
      throw new EventsAuthError(
        'API key required for retrieving events. Set apiKey in config or COMPUTESDK_API_KEY env var.'
      );
    }

    const params = new URLSearchParams();
    if (options.type) params.set('type', options.type);
    if (options.since) params.set('since', options.since.toString());
    if (options.limit != null) {
      // Clamp limit to valid range (1-1000)
      const limit = Math.min(Math.max(1, options.limit), 1000);
      params.set('limit', limit.toString());
    }

    const queryString = params.toString();
    const url = `/events/${sandboxId}${queryString ? `?${queryString}` : ''}`;

    const response = await this.fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const result = (await response.json()) as {
      success: boolean;
      data: {
        sandboxId: string;
        events: SandboxEvent[];
        count: number;
      };
    };

    if (!result.success || !result.data) {
      throw new EventsError('Invalid response from server', response.status);
    }

    return result.data.events;
  }

  /**
   * Update the API key (for retrieving events)
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Update the access token (for storing events)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.gatewayUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new EventsNetworkError(
            `Request timed out after ${this.timeout}ms`,
            error
          );
        }
        throw new EventsNetworkError(`Network error: ${error.message}`, error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const text = await response.text().catch(() => response.statusText);

    if (response.status === 401) {
      throw new EventsAuthError(text || 'Authentication required');
    }

    throw new EventsError(text || 'Request failed', response.status);
  }
}

/**
 * Create an events client with sensible defaults
 */
export function createEventsClient(
  config: Partial<EventsClientConfig> = {}
): EventsClient {
  return new EventsClient(config);
}

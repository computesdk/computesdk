/**
 * Event stored in the gateway
 */
export interface SandboxEvent {
  id: string;
  sandboxId: string;
  workspaceId: number;
  type: string;
  data: Record<string, unknown>;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Options for retrieving events
 */
export interface GetEventsOptions {
  /** Filter by event type */
  type?: string;
  /** Only return events after this Unix timestamp (milliseconds) */
  since?: number;
  /** Maximum number of events to return (default: 100, max: 1000) */
  limit?: number;
}

/**
 * Options for storing an event
 */
export interface StoreEventOptions {
  /** Event type identifier (e.g., "execution.started") */
  type: string;
  /** Arbitrary event data */
  data?: Record<string, unknown>;
}

/**
 * Result from storing an event
 */
export interface StoreEventResult {
  eventId: string;
  sandboxId: string;
  type: string;
  timestamp: number;
}

/**
 * Configuration for the Events HTTP client
 */
export interface EventsClientConfig {
  /** Gateway base URL (default: "https://events.computesdk.com") */
  gatewayUrl?: string;
  /** ComputeSDK API key (for retrieving events) */
  apiKey?: string;
  /** JWT access token (for storing events from compute daemon) */
  accessToken?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Configuration for the Pub/Sub client (Node.js only)
 */
export interface PubSubClientConfig {
  /** Gateway host (default: "events.computesdk.com") */
  host?: string;
  /** Pub/Sub port (default: 6380) */
  port?: number;
  /** JWT access token for authentication */
  accessToken: string;
  /** Sandbox ID to subscribe to */
  sandboxId: string;
  /** Reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds (default: 1000) */
  reconnectDelay?: number;
}

/**
 * Pub/Sub event listener
 */
export type EventListener = (event: SandboxEvent) => void;

/**
 * Pub/Sub connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

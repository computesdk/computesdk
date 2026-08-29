# compute.events

Events SDK for ComputeSDK - store, retrieve, and subscribe to sandbox events in real-time.

## Installation

```bash
npm install @computesdk/events
```

## Quick Start

### Storing Events (from inside a sandbox)

Use the HTTP client to store events from your sandbox code:

```typescript
import { createEventsClient } from '@computesdk/events';

const client = createEventsClient({
  accessToken: process.env.COMPUTESDK_ACCESS_TOKEN,
});

// Store an event
const result = await client.storeEvent({
  type: 'execution.completed',
  data: {
    exitCode: 0,
    duration: 1234,
    output: 'Hello, World!',
  },
});

console.log('Event stored:', result.eventId);
```

### Retrieving Events (from your application)

Use your API key to retrieve historical events:

```typescript
import { createEventsClient } from '@computesdk/events';

const client = createEventsClient({
  apiKey: process.env.COMPUTESDK_API_KEY,
});

// Get all events for a sandbox
const events = await client.getEvents('sandbox-123');

// Filter by type
const execEvents = await client.getEvents('sandbox-123', {
  type: 'execution.completed',
});

// Get events since a timestamp
const recentEvents = await client.getEvents('sandbox-123', {
  since: Date.now() - 3600000, // Last hour
  limit: 50,
});

for (const event of events) {
  console.log(`[${event.type}] ${JSON.stringify(event.data)}`);
}
```

### Real-time Streaming (Node.js)

Subscribe to events in real-time using the Pub/Sub client:

```typescript
import { createPubSubClient } from '@computesdk/events';

const pubsub = createPubSubClient({
  accessToken: process.env.COMPUTESDK_ACCESS_TOKEN,
  sandboxId: 'sandbox-123',
});

// Listen for events
pubsub.on('event', (event) => {
  console.log(`Received: ${event.type}`, event.data);
});

pubsub.on('connect', () => {
  console.log('Connected to event stream');
});

pubsub.on('disconnect', () => {
  console.log('Disconnected (will auto-reconnect)');
});

pubsub.on('error', (error) => {
  console.error('Connection error:', error);
});

// Connect and start receiving events
await pubsub.connect();

// Keep connection alive with periodic pings
setInterval(() => pubsub.ping(), 30000);

// Disconnect when done
await pubsub.disconnect();
```

## API Reference

### EventsClient

HTTP client for storing and retrieving events.

#### Constructor Options

```typescript
interface EventsClientConfig {
  /** Gateway base URL (default: "https://events.computesdk.com") */
  gatewayUrl?: string;
  /** ComputeSDK API key (for retrieving events) */
  apiKey?: string;
  /** JWT access token (for storing events from sandbox) */
  accessToken?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}
```

#### Methods

##### `storeEvent(options)` - Store an event (requires access token)

```typescript
const result = await client.storeEvent({
  type: 'custom.event',
  data: { key: 'value' },
});
// Returns: { eventId, sandboxId, type, timestamp }
```

##### `getEvents(sandboxId, options?)` - Retrieve events (requires API key)

```typescript
const events = await client.getEvents('sandbox-123', {
  type: 'execution.completed', // Filter by type
  since: Date.now() - 3600000, // Events after timestamp (ms)
  limit: 100,                   // Max events (1-1000)
});
```

##### `setApiKey(apiKey)` - Update the API key

##### `setAccessToken(token)` - Update the access token

### EventsPubSubClient

TCP client for real-time event streaming (Node.js only).

#### Constructor Options

```typescript
interface PubSubClientConfig {
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
```

#### Methods

##### `connect()` - Connect and subscribe to events

##### `disconnect()` - Disconnect from the server

##### `getState()` - Get connection state

Returns: `'disconnected' | 'connecting' | 'connected' | 'error'`

##### `ping()` - Send a keepalive ping

#### Events

```typescript
pubsub.on('event', (event: SandboxEvent) => { ... });
pubsub.on('connect', () => { ... });
pubsub.on('disconnect', () => { ... });
pubsub.on('error', (error: Error) => { ... });
```

## Types

### SandboxEvent

```typescript
interface SandboxEvent {
  id: string;
  sandboxId: string;
  workspaceId: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number; // Unix timestamp in milliseconds
}
```

## Error Handling

The package exports specific error classes:

```typescript
import {
  EventsError,        // Base error class
  EventsAuthError,    // Authentication failures
  EventsNetworkError, // Network/timeout errors
  EventsPubSubError,  // Pub/Sub specific errors
} from '@computesdk/events';

try {
  await client.getEvents('sandbox-123');
} catch (error) {
  if (error instanceof EventsAuthError) {
    console.error('Check your API key');
  } else if (error instanceof EventsNetworkError) {
    console.error('Network issue:', error.message);
  }
}
```

## Environment Variables

The client automatically reads these environment variables:

| Variable | Description |
|----------|-------------|
| `COMPUTESDK_API_KEY` | API key for retrieving events |
| `COMPUTESDK_ACCESS_TOKEN` | Access token for storing events |
| `COMPUTESDK_GATEWAY_URL` | Custom gateway URL |
| `COMPUTESDK_PUBSUB_HOST` | Custom pub/sub host |
| `COMPUTESDK_PUBSUB_PORT` | Custom pub/sub port |

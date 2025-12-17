/**
 * Standard event types for ComputeSDK sandboxes
 */
export const EventTypes = {
  // Execution events
  EXECUTION_STARTED: 'execution.started',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_TIMEOUT: 'execution.timeout',

  // File events
  FILE_CREATED: 'file.created',
  FILE_UPDATED: 'file.updated',
  FILE_DELETED: 'file.deleted',
  FILE_READ: 'file.read',

  // Terminal events
  TERMINAL_CREATED: 'terminal.created',
  TERMINAL_OUTPUT: 'terminal.output',
  TERMINAL_INPUT: 'terminal.input',
  TERMINAL_CLOSED: 'terminal.closed',

  // Process events
  PROCESS_STARTED: 'process.started',
  PROCESS_EXITED: 'process.exited',
  PROCESS_SIGNAL: 'process.signal',

  // HTTP events
  HTTP_REQUEST: 'http.request',
  HTTP_RESPONSE: 'http.response',

  // System events
  SYSTEM_READY: 'system.ready',
  SYSTEM_SHUTDOWN: 'system.shutdown',
  SYSTEM_ERROR: 'system.error',

  // Custom events
  CUSTOM: 'custom',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/**
 * Default configuration values
 */
export const DEFAULT_GATEWAY_URL = 'https://events.computesdk.com';
export const DEFAULT_PUBSUB_HOST = 'events.computesdk.com';
export const DEFAULT_PUBSUB_PORT = 6380;
export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_RECONNECT_DELAY = 1000;

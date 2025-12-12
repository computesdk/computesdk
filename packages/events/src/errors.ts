/**
 * Base error class for Events SDK
 */
export class EventsError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'EventsError';
  }
}

/**
 * Authentication error (missing or invalid credentials)
 */
export class EventsAuthError extends EventsError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'EventsAuthError';
  }
}

/**
 * Network error (connection failures, timeouts)
 */
export class EventsNetworkError extends EventsError {
  constructor(
    message: string,
    public originalError: Error
  ) {
    super(message);
    this.name = 'EventsNetworkError';
  }
}

/**
 * Pub/Sub specific error
 */
export class EventsPubSubError extends EventsError {
  constructor(message: string) {
    super(message);
    this.name = 'EventsPubSubError';
  }
}

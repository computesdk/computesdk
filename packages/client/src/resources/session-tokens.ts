/**
 * SessionTokens - Resource namespace for session token management
 */

import type { SessionTokenResponse, SessionTokenListResponse } from '../index';

/**
 * Session token info
 */
export interface SessionTokenInfo {
  id: string;
  token?: string; // Only present when creating
  description?: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
}

/**
 * SessionTokens resource namespace
 *
 * @example
 * ```typescript
 * // Create a session token (requires access token)
 * const token = await sandbox.sessionTokens.create({
 *   description: 'My Application',
 *   expiresIn: 604800, // 7 days
 * });
 * console.log(token.token);
 *
 * // List all session tokens
 * const tokens = await sandbox.sessionTokens.list();
 *
 * // Retrieve a specific token
 * const token = await sandbox.sessionTokens.retrieve(id);
 *
 * // Revoke a token
 * await sandbox.sessionTokens.revoke(id);
 * ```
 */
export class SessionTokens {
  private createHandler: (options?: {
    description?: string;
    expiresIn?: number;
  }) => Promise<SessionTokenResponse>;
  private listHandler: () => Promise<SessionTokenListResponse>;
  private retrieveHandler: (id: string) => Promise<SessionTokenResponse>;
  private revokeHandler: (id: string) => Promise<void>;

  constructor(handlers: {
    create: (options?: {
      description?: string;
      expiresIn?: number;
    }) => Promise<SessionTokenResponse>;
    list: () => Promise<SessionTokenListResponse>;
    retrieve: (id: string) => Promise<SessionTokenResponse>;
    revoke: (id: string) => Promise<void>;
  }) {
    this.createHandler = handlers.create;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.revokeHandler = handlers.revoke;
  }

  /**
   * Create a new session token (requires access token)
   * @param options - Token configuration
   * @param options.description - Description for the token
   * @param options.expiresIn - Expiration time in seconds (default: 7 days)
   * @returns Session token info including the token value
   */
  async create(options?: {
    description?: string;
    expiresIn?: number;
  }): Promise<SessionTokenInfo> {
    const response = await this.createHandler(options);
    return {
      id: response.id,
      token: response.token,
      description: response.description,
      createdAt: response.createdAt,
      expiresAt: response.expiresAt,
    };
  }

  /**
   * List all session tokens
   * @returns Array of session token info
   */
  async list(): Promise<SessionTokenInfo[]> {
    const response = await this.listHandler();
    return response.data.tokens.map((t) => ({
      id: t.id,
      description: t.description,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      lastUsedAt: t.last_used_at,
    }));
  }

  /**
   * Retrieve a specific session token by ID
   * @param id - The token ID
   * @returns Session token info
   */
  async retrieve(id: string): Promise<SessionTokenInfo> {
    const response = await this.retrieveHandler(id);
    return {
      id: response.id,
      description: response.description,
      createdAt: response.createdAt,
      expiresAt: response.expiresAt,
    };
  }

  /**
   * Revoke a session token
   * @param id - The token ID to revoke
   */
  async revoke(id: string): Promise<void> {
    return this.revokeHandler(id);
  }
}

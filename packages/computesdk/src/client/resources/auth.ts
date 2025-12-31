/**
 * Auth - Resource namespace for authentication info
 */

import type { AuthStatusResponse, AuthInfoResponse } from '../index';

/**
 * Authentication status info
 */
export interface AuthStatusInfo {
  authenticated: boolean;
  tokenType?: 'access_token' | 'session_token';
  expiresAt?: string;
}

/**
 * Authentication endpoints info
 */
export interface AuthEndpointsInfo {
  createSessionToken: string;
  listSessionTokens: string;
  getSessionToken: string;
  revokeSessionToken: string;
  createMagicLink: string;
  authStatus: string;
  authInfo: string;
}

/**
 * Authentication info
 */
export interface AuthInfo {
  message: string;
  instructions: string;
  endpoints: AuthEndpointsInfo;
}

/**
 * Auth resource namespace
 *
 * @example
 * ```typescript
 * // Check authentication status
 * const status = await sandbox.auth.status();
 * console.log(status.authenticated);
 * console.log(status.tokenType);
 *
 * // Get authentication info and instructions
 * const info = await sandbox.auth.info();
 * console.log(info.instructions);
 * ```
 */
export class Auth {
  private statusHandler: () => Promise<AuthStatusResponse>;
  private infoHandler: () => Promise<AuthInfoResponse>;

  constructor(handlers: {
    status: () => Promise<AuthStatusResponse>;
    info: () => Promise<AuthInfoResponse>;
  }) {
    this.statusHandler = handlers.status;
    this.infoHandler = handlers.info;
  }

  /**
   * Check authentication status
   * @returns Authentication status info
   */
  async status(): Promise<AuthStatusInfo> {
    const response = await this.statusHandler();
    return {
      authenticated: response.data.authenticated,
      tokenType: response.data.token_type,
      expiresAt: response.data.expires_at,
    };
  }

  /**
   * Get authentication information and usage instructions
   * @returns Authentication info
   */
  async info(): Promise<AuthInfo> {
    const response = await this.infoHandler();
    return {
      message: response.data.message,
      instructions: response.data.instructions,
      endpoints: {
        createSessionToken: response.data.endpoints.create_session_token,
        listSessionTokens: response.data.endpoints.list_session_tokens,
        getSessionToken: response.data.endpoints.get_session_token,
        revokeSessionToken: response.data.endpoints.revoke_session_token,
        createMagicLink: response.data.endpoints.create_magic_link,
        authStatus: response.data.endpoints.auth_status,
        authInfo: response.data.endpoints.auth_info,
      },
    };
  }
}

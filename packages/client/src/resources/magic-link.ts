/**
 * MagicLink - Resource namespace for magic link operations
 */

import type { MagicLinkResponse } from '../index';

/**
 * Magic link info
 */
export interface MagicLinkInfo {
  url: string;
  expiresAt: string;
  redirectUrl: string;
}

/**
 * MagicLink resource namespace
 *
 * @example
 * ```typescript
 * // Create a magic link (requires access token)
 * const link = await sandbox.magicLink.create({
 *   redirectUrl: '/dashboard',
 * });
 * console.log(link.url);
 * ```
 */
export class MagicLink {
  private createHandler: (options?: {
    redirectUrl?: string;
  }) => Promise<MagicLinkResponse>;

  constructor(handlers: {
    create: (options?: { redirectUrl?: string }) => Promise<MagicLinkResponse>;
  }) {
    this.createHandler = handlers.create;
  }

  /**
   * Create a magic link for browser authentication (requires access token)
   *
   * Magic links are one-time URLs that automatically create a session token
   * and set it as a cookie in the user's browser.
   *
   * @param options - Magic link configuration
   * @param options.redirectUrl - URL to redirect to after authentication
   * @returns Magic link info including the URL
   */
  async create(options?: { redirectUrl?: string }): Promise<MagicLinkInfo> {
    const response = await this.createHandler(options);
    return {
      url: response.data.magic_url,
      expiresAt: response.data.expires_at,
      redirectUrl: response.data.redirect_url,
    };
  }
}

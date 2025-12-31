/**
 * Env - Resource namespace for environment variable operations
 */

import type { EnvGetResponse, EnvSetResponse, EnvDeleteResponse } from '../index';

/**
 * Env resource namespace
 *
 * @example
 * ```typescript
 * // Retrieve environment variables
 * const vars = await sandbox.env.retrieve('.env');
 * console.log(vars);
 *
 * // Update environment variables (merges with existing)
 * await sandbox.env.update('.env', {
 *   API_KEY: 'secret',
 *   DEBUG: 'true',
 * });
 *
 * // Remove environment variables
 * await sandbox.env.remove('.env', ['OLD_KEY', 'DEPRECATED']);
 * ```
 */
export class Env {
  private retrieveHandler: (file: string) => Promise<EnvGetResponse>;
  private updateHandler: (
    file: string,
    variables: Record<string, string>
  ) => Promise<EnvSetResponse>;
  private removeHandler: (file: string, keys: string[]) => Promise<EnvDeleteResponse>;
  private existsHandler: (file: string) => Promise<boolean>;

  constructor(handlers: {
    retrieve: (file: string) => Promise<EnvGetResponse>;
    update: (
      file: string,
      variables: Record<string, string>
    ) => Promise<EnvSetResponse>;
    remove: (file: string, keys: string[]) => Promise<EnvDeleteResponse>;
    exists: (file: string) => Promise<boolean>;
  }) {
    this.retrieveHandler = handlers.retrieve;
    this.updateHandler = handlers.update;
    this.removeHandler = handlers.remove;
    this.existsHandler = handlers.exists;
  }

  /**
   * Retrieve environment variables from a file
   * @param file - Path to the .env file (relative to sandbox root)
   * @returns Key-value map of environment variables
   */
  async retrieve(file: string): Promise<Record<string, string>> {
    const response = await this.retrieveHandler(file);
    return response.data.variables;
  }

  /**
   * Update (merge) environment variables in a file
   * @param file - Path to the .env file (relative to sandbox root)
   * @param variables - Key-value pairs to set
   * @returns Keys that were updated
   */
  async update(
    file: string,
    variables: Record<string, string>
  ): Promise<string[]> {
    const response = await this.updateHandler(file, variables);
    return response.data.keys;
  }

  /**
   * Remove environment variables from a file
   * @param file - Path to the .env file (relative to sandbox root)
   * @param keys - Keys to remove
   * @returns Keys that were removed
   */
  async remove(file: string, keys: string[]): Promise<string[]> {
    const response = await this.removeHandler(file, keys);
    return response.data.keys;
  }

  /**
   * Check if an environment file exists
   * @param file - Path to the .env file (relative to sandbox root)
   * @returns True if file exists
   */
  async exists(file: string): Promise<boolean> {
    return this.existsHandler(file);
  }
}

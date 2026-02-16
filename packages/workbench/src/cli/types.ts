/**
 * Workbench type definitions
 */

import type { Command } from '@computesdk/cmd';

/**
 * Command execution result
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Provider status information
 */
export interface ProviderStatus {
  name: string;
  isComplete: boolean;
  present: string[];
  missing: string[];
}

/**
 * Type guard to check if value is a Command (string array)
 */
export function isCommand(value: unknown): value is Command {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string'
  );
}

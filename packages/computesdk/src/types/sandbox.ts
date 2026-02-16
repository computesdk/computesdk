/**
 * Sandbox Types
 *
 * Re-exports sandbox types from the client package.
 * This file exists for backward compatibility.
 */

// Re-export everything from client
export { Sandbox, type SandboxConfig } from '../client';
export type * from '../client/types';
export type { CodeResult, CommandResult, CodeLanguage, CodeRunOptions, CommandRunOptions } from '../client/resources/run';

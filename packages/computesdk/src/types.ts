/**
 * ComputeSDK Types
 * 
 * This file contains all the type definitions for the ComputeSDK.
 */

/**
 * Supported runtime environments
 */
export type Runtime = 'node' | 'python';

/**
 * Supported provider types
 */
export type ProviderType = 'e2b' | 'vercel' | 'cloudflare' | 'fly' | 'auto';

/**
 * Sandbox status types
 */
export type SandboxStatus = 'running' | 'stopped' | 'error';

/**
 * Result of code execution
 */
export interface ExecutionResult {
  /** Standard output from the execution */
  stdout: string;
  /** Standard error from the execution */
  stderr: string;
  /** Exit code from the execution */
  exitCode: number;
  /** Time taken for execution in milliseconds */
  executionTime: number;
  /** ID of the sandbox where the code was executed */
  sandboxId: string;
  /** Provider that executed the code */
  provider: string;
}

/**
 * Information about a sandbox
 */
export interface SandboxInfo {
  /** Unique identifier for the sandbox */
  id: string;
  /** Provider hosting the sandbox */
  provider: string;
  /** Runtime environment in the sandbox */
  runtime: Runtime;
  /** Current status of the sandbox */
  status: SandboxStatus;
  /** When the sandbox was created */
  createdAt: Date;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Additional provider-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Configuration for container-based providers
 */
export interface ContainerConfig {
  /** Docker image to use */
  image: string;
  /** Command to run in the container */
  command?: string[];
  /** Environment variables for the container */
  env?: Record<string, string>;
  /** Ports to expose from the container */
  ports?: number[];
  /** Working directory in the container */
  workdir?: string;
}

/**
 * Configuration for creating a compute sandbox
 */
export interface SandboxConfig {
  /** Provider to use for execution */
  provider?: ProviderType;
  /** Runtime environment to use */
  runtime?: Runtime;
  /** Container configuration if using container-based provider */
  container?: string | ContainerConfig;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Provider specification that all providers must implement
 */
export interface ComputeSpecification {
  /** Version of the specification */
  specificationVersion: 'v1';
  /** Provider identifier */
  provider: string;
  /** Sandbox identifier */
  sandboxId: string;

  /** Execute code in the sandbox */
  doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Kill the sandbox */
  doKill(): Promise<void>;
  /** Get information about the sandbox */
  doGetInfo(): Promise<SandboxInfo>;
}

/**
 * The core compute sandbox interface that all providers expose
 */
export interface ComputeSandbox {
  /** Provider identifier */
  provider: string;
  /** Sandbox identifier */
  sandboxId: string;

  /** Execute code in the sandbox */
  execute(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Kill the sandbox */
  kill(): Promise<void>;
  /** Get information about the sandbox */
  getInfo(): Promise<SandboxInfo>;
}

/**
 * Parameters for the executeSandbox function
 */
export interface ExecuteSandboxParams {
  /** Sandbox to execute in */
  sandbox: ComputeSandbox;
  /** Code to execute */
  code: string;
  /** Runtime to use */
  runtime?: Runtime;
}

/**
 * Provider registry configuration
 */
export interface ProviderRegistry {
  /** Get a sandbox by ID */
  sandbox(id: string): ComputeSandbox;
}

/**
 * Provider factory function type
 */
export type ProviderFactory = (config?: any) => ComputeSandbox;

/**
 * Provider registry map type
 */
export type ProviderMap = Record<string, ProviderFactory>;

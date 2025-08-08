/**
 * Server-side adapter for unified compute operations
 * 
 * Provides a single HTTP endpoint interface that can handle all compute operations
 * across different providers and capabilities (sandbox, filesystem, terminal).
 */


import type { 
  ComputeRequest, 
  ComputeResponse, 
  Runtime,
  FilesystemComputeSandbox,
  BaseComputeSandbox,
  ComputeSandbox
} from './types';

/**
 * Parameters for handleComputeRequest function
 */
export interface HandleComputeRequestParams {
  /** The compute request containing operation, action, and payload */
  request: ComputeRequest;
  /** The provider instance to execute the request with */
  provider: ComputeSandbox;
}

/**
 * Handles a unified compute request and returns a standardized response
 * 
 * @param params - Object containing request and provider
 * @returns Promise<ComputeResponse> - Standardized response with success/error info
 */
export async function handleComputeRequest(params: HandleComputeRequestParams): Promise<ComputeResponse> {
  const { request, provider } = params;
  const startTime = Date.now();
  
  try {
    // Validate request structure
    if (!request.operation || !request.action) {
      return {
        success: false,
        error: 'Missing required fields: operation and action are required',
        sandboxId: '',
        provider: 'unknown',
        executionTime: Date.now() - startTime
      };
    }

    let result: any;

    // Route to appropriate operation handler
    if (request.operation === 'sandbox') {
      result = await handleSandboxOperation(provider, request.action, request.payload);
    } else if (request.operation === 'filesystem') {
      result = await handleFilesystemOperation(provider, request.action, request.payload);
    } else {
      return {
        success: false,
        error: `Unknown operation: ${request.operation}. Supported operations: sandbox, filesystem`,
        sandboxId: provider.sandboxId,
        provider: provider.provider,
        executionTime: Date.now() - startTime
      };
    }

    return {
      success: true,
      data: result,
      sandboxId: provider.sandboxId,
      provider: provider.provider,
      executionTime: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      sandboxId: provider.sandboxId || '',
      provider: provider.provider || 'unknown',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Handles sandbox operations (execute, runCommand, getInfo, kill)
 */
async function handleSandboxOperation(
  sandbox: BaseComputeSandbox, 
  action: string, 
  payload: Record<string, any>
): Promise<any> {
  switch (action) {
    case 'execute':
    case 'runCode':
      if (!payload.code) {
        throw new Error('Missing required field: code');
      }
      return await sandbox.execute(payload.code, payload.runtime as Runtime);

    case 'runCommand':
      if (!payload.command) {
        throw new Error('Missing required field: command');
      }
      return await sandbox.runCommand(payload.command, payload.args || []);

    case 'getInfo':
      return await sandbox.getInfo();

    case 'kill':
      await sandbox.kill();
      return { message: 'Sandbox terminated successfully' };

    default:
      throw new Error(`Unknown sandbox action: ${action}. Supported actions: execute, runCode, runCommand, getInfo, kill`);
  }
}

/**
 * Handles filesystem operations (readFile, writeFile, mkdir, readdir, exists, remove)
 */
async function handleFilesystemOperation(
  sandbox: BaseComputeSandbox, 
  action: string, 
  payload: Record<string, any>
): Promise<any> {
  // Check if sandbox supports filesystem operations
  if (!('filesystem' in sandbox)) {
    throw new Error(`Provider ${sandbox.provider} does not support filesystem operations`);
  }

  const fs = (sandbox as FilesystemComputeSandbox).filesystem;

  switch (action) {
    case 'readFile':
      if (!payload.path) {
        throw new Error('Missing required field: path');
      }
      return { content: await fs.readFile(payload.path) };

    case 'writeFile':
      if (!payload.path || payload.content === undefined) {
        throw new Error('Missing required fields: path and content');
      }
      await fs.writeFile(payload.path, payload.content);
      return { message: 'File written successfully' };

    case 'mkdir':
      if (!payload.path) {
        throw new Error('Missing required field: path');
      }
      await fs.mkdir(payload.path);
      return { message: 'Directory created successfully' };

    case 'readdir':
      if (!payload.path) {
        throw new Error('Missing required field: path');
      }
      return { entries: await fs.readdir(payload.path) };

    case 'exists':
      if (!payload.path) {
        throw new Error('Missing required field: path');
      }
      return { exists: await fs.exists(payload.path) };

    case 'remove':
      if (!payload.path) {
        throw new Error('Missing required field: path');
      }
      await fs.remove(payload.path);
      return { message: 'File/directory removed successfully' };

    default:
      throw new Error(`Unknown filesystem action: ${action}. Supported actions: readFile, writeFile, mkdir, readdir, exists, remove`);
  }
}
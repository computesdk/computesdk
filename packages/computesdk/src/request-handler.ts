/**
 * Simplified Request Handler for Web Framework Integration
 * 
 * Handles JSON requests for sandbox and code execution operations.
 * Terminal support removed - will be re-added with WebSocket VM connections.
 */

import type { Provider, Runtime } from './types';
import { compute } from './compute';

/**
 * Request structure supporting sandbox and code execution capabilities
 */
export interface ComputeRequest {
  /** Action in dot notation (e.g., 'compute.sandbox.create') */
  action: string;
  
  /** Parameters for the action */
  sandboxId?: string;
  code?: string;
  command?: string;
  args?: string[];
  runtime?: Runtime;
  path?: string;
  content?: string;
  
  /** Sandbox creation options */
  options?: {
    runtime?: Runtime;
    timeout?: number;
    sandboxId?: string;
  };
}

/**
 * Response structure for compute operations
 */
export interface ComputeResponse {
  success: boolean;
  error?: string;
  sandboxId: string;
  provider: string;
  [key: string]: any; // Allow any additional response data
}

/**
 * Execute compute action using targeted handling
 */
async function executeAction(body: ComputeRequest, provider: Provider): Promise<ComputeResponse> {
  try {
    const { action, sandboxId } = body;
    
    // Sandbox management operations
    if (action === 'compute.sandbox.create') {
      const sandbox = await compute.sandbox.create({
        provider,
        options: body.options || { runtime: 'python' }
      });
      return {
        success: true,
        sandboxId: sandbox.sandboxId,
        provider: provider.name
      };
    }
    
    if (action === 'compute.sandbox.list') {
      const sandboxes = await compute.sandbox.list(provider);
      return {
        success: true,
        sandboxId: '',
        provider: provider.name,
        sandboxes: sandboxes.map(sb => ({
          sandboxId: sb.sandboxId,
          provider: sb.provider
        }))
      };
    }
    
    if (action === 'compute.sandbox.destroy') {
      if (!sandboxId) {
        throw new Error('sandboxId is required for destroy action');
      }
      await compute.sandbox.destroy(provider, sandboxId);
      return {
        success: true,
        sandboxId,
        provider: provider.name
      };
    }
    
    // For sandbox instance methods, get the sandbox first
    if (!sandboxId) {
      throw new Error('sandboxId is required for this action');
    }
    
    const sandbox = await compute.sandbox.getById(provider, sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }
    
    // Sandbox info
    if (action === 'compute.sandbox.getInfo') {
      const result = await sandbox.getInfo();
      return {
        success: true,
        sandboxId,
        provider: provider.name,
        info: {
          id: result.id,
          provider: result.provider,
          runtime: result.runtime,
          status: result.status,
          createdAt: result.createdAt.toISOString(),
          timeout: result.timeout,
          metadata: result.metadata
        }
      };
    }
    
    // Code execution
    if (action === 'compute.sandbox.runCode') {
      if (!body.code) throw new Error('code is required');
      const result = await sandbox.runCode(body.code, body.runtime);
      return {
        success: true,
        sandboxId,
        provider: provider.name,
        result: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: result.executionTime
        }
      };
    }
    
    if (action === 'compute.sandbox.runCommand') {
      if (!body.command) throw new Error('command is required');
      const result = await sandbox.runCommand(body.command, body.args);
      return {
        success: true,
        sandboxId,
        provider: provider.name,
        result: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: result.executionTime
        }
      };
    }
    
    // Filesystem operations
    if (action === 'compute.sandbox.filesystem.readFile') {
      if (!body.path) throw new Error('path is required');
      const result = await sandbox.filesystem.readFile(body.path);
      return {
        success: true,
        sandboxId,
        provider: provider.name,
        fileContent: result
      };
    }
    
    if (action === 'compute.sandbox.filesystem.writeFile') {
      if (!body.path) throw new Error('path is required');
      if (body.content === undefined) throw new Error('content is required');
      await sandbox.filesystem.writeFile(body.path, body.content);
      return { success: true, sandboxId, provider: provider.name };
    }
    
    if (action === 'compute.sandbox.filesystem.mkdir') {
      if (!body.path) throw new Error('path is required');
      await sandbox.filesystem.mkdir(body.path);
      return { success: true, sandboxId, provider: provider.name };
    }
    
    if (action === 'compute.sandbox.filesystem.readdir') {
      if (!body.path) throw new Error('path is required');
      const result = await sandbox.filesystem.readdir(body.path);
      return {
        success: true,
        sandboxId,
        provider: provider.name,
        files: result.map((entry: any) => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          size: entry.size,
          lastModified: entry.lastModified.toISOString()
        }))
      };
    }
    
    if (action === 'compute.sandbox.filesystem.exists') {
      if (!body.path) throw new Error('path is required');
      const result = await sandbox.filesystem.exists(body.path);
      return {
        success: true,
        sandboxId,
        provider: provider.name,
        exists: result
      };
    }
    
    if (action === 'compute.sandbox.filesystem.remove') {
      if (!body.path) throw new Error('path is required');
      await sandbox.filesystem.remove(body.path);
      return { success: true, sandboxId, provider: provider.name };
    }
    
    throw new Error(`Unknown action: ${action}`);
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      sandboxId: body.sandboxId || '',
      provider: provider.name
    };
  }
}

/**
 * Main request handler - handles HTTP requests and pre-parsed bodies
 */
export async function handleComputeRequest(
  params: HandleComputeRequestParams
): Promise<ComputeResponse>;
export async function handleComputeRequest(
  requestOrBody: Request | ComputeRequest,
  provider: Provider
): Promise<Response>;
export async function handleComputeRequest(
  paramsOrRequestOrBody: HandleComputeRequestParams | Request | ComputeRequest,
  provider?: Provider
): Promise<ComputeResponse | Response> {
  // Handle object-style API
  if (typeof paramsOrRequestOrBody === 'object' && 'request' in paramsOrRequestOrBody && 'provider' in paramsOrRequestOrBody) {
    const params = paramsOrRequestOrBody as HandleComputeRequestParams;
    return await executeAction(params.request, params.provider);
  }
  
  // Handle original API
  if (!provider) {
    throw new Error('Provider is required when not using object-style API');
  }
  
  const requestOrBody = paramsOrRequestOrBody as Request | ComputeRequest;
  try {
    let body: ComputeRequest;
    
    if (requestOrBody instanceof Request) {
      // Handle HTTP method validation
      if (requestOrBody.method !== 'POST') {
        return Response.json({
          success: false,
          error: 'Only POST requests are supported',
          sandboxId: '',
          provider: provider.name
        }, { status: 405 });
      }
      
      // Parse JSON body with better error handling
      try {
        body = await requestOrBody.json();
      } catch (parseError) {
        return Response.json({
          success: false,
          error: 'Invalid JSON in request body',
          sandboxId: '',
          provider: provider.name
        }, { status: 400 });
      }
    } else {
      body = requestOrBody;
    }
    
    // Execute the action
    const result = await executeAction(body, provider);
    
    return Response.json(result, {
      status: result.success ? 200 : 500
    });
    
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Request handling failed',
      sandboxId: '',
      provider: provider.name
    }, { status: 500 });
  }
}

/**
 * Legacy export for backward compatibility
 */
export interface HandleComputeRequestParams {
  request: ComputeRequest;
  provider: Provider;
}

export { handleComputeRequest as handleHttpComputeRequest };
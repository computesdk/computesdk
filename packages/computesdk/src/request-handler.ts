/**
 * Simplified Request Handler for Web Framework Integration
 * 
 * Handles JSON requests for sandbox and code execution operations.
 */

import { compute } from './compute';

// Gateway-specific runtime (subset of universal Runtime)
type GatewayRuntime = 'node' | 'python';

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
  runtime?: GatewayRuntime;
  path?: string;
  content?: string;
  
  /** Command options (for runCommand action) */
  commandOptions?: {
    background?: boolean;
  };
  
  /** Sandbox creation options */
  options?: {
    runtime?: GatewayRuntime;
    timeout?: number;
    name?: string;
    namespace?: string;
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
async function executeAction(body: ComputeRequest): Promise<ComputeResponse> {
  try {
    const { action, sandboxId } = body;
    
    // Sandbox management operations
    if (action === 'compute.sandbox.create') {
      const sandbox = await compute.sandbox.create(body.options || { runtime: 'python' });
      return {
        success: true,
        sandboxId: sandbox.sandboxId,
        provider: sandbox.provider
      };
    }
    
    if (action === 'compute.sandbox.list') {
      throw new Error('List operation not supported in gateway mode');
    }
    
    if (action === 'compute.sandbox.destroy') {
      if (!sandboxId) {
        throw new Error('sandboxId is required for destroy action');
      }
      await compute.sandbox.destroy(sandboxId);
      return {
        success: true,
        sandboxId,
        provider: 'gateway'
      };
    }
    
    // For sandbox instance methods, get the sandbox first
    if (!sandboxId) {
      throw new Error('sandboxId is required for this action');
    }
    
    const sandbox = await compute.sandbox.getById(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }
    
    // Sandbox info
    if (action === 'compute.sandbox.getInfo') {
      const result = await sandbox.getInfo();
      return {
        success: true,
        sandboxId,
        provider: sandbox.provider,
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
        provider: sandbox.provider,
        result: {
          output: result.output,
          exitCode: result.exitCode,
          language: result.language
        }
      };
    }

    if (action === 'compute.sandbox.runCommand') {
      if (!body.command) throw new Error('command is required');
      const result = await sandbox.runCommand(body.command, body.args, body.commandOptions);
      return {
        success: true,
        sandboxId,
        provider: sandbox.provider,
        result: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs
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
        provider: sandbox.provider,
        fileContent: result
      };
    }
    
    if (action === 'compute.sandbox.filesystem.writeFile') {
      if (!body.path) throw new Error('path is required');
      if (body.content === undefined) throw new Error('content is required');
      await sandbox.filesystem.writeFile(body.path, body.content);
      return { success: true, sandboxId, provider: sandbox.provider };
    }
    
    if (action === 'compute.sandbox.filesystem.mkdir') {
      if (!body.path) throw new Error('path is required');
      await sandbox.filesystem.mkdir(body.path);
      return { success: true, sandboxId, provider: sandbox.provider };
    }
    
    if (action === 'compute.sandbox.filesystem.readdir') {
      if (!body.path) throw new Error('path is required');
      const result = await sandbox.filesystem.readdir(body.path);
      return {
        success: true,
        sandboxId,
        provider: sandbox.provider,
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
        provider: sandbox.provider,
        exists: result
      };
    }
    
    if (action === 'compute.sandbox.filesystem.remove') {
      if (!body.path) throw new Error('path is required');
      await sandbox.filesystem.remove(body.path);
      return { success: true, sandboxId, provider: sandbox.provider };
    }
    
    throw new Error(`Unknown action: ${action}`);
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      sandboxId: body.sandboxId || '',
      provider: 'gateway'
    };
  }
}

/**
 * Main request handler - handles HTTP requests and pre-parsed bodies
 */
export async function handleComputeRequest(
  requestOrBody: Request | ComputeRequest
): Promise<Response | ComputeResponse> {
  try {
    let body: ComputeRequest;
    
    if (requestOrBody instanceof Request) {
      // Handle HTTP method validation
      if (requestOrBody.method !== 'POST') {
        return Response.json({
          success: false,
          error: 'Only POST requests are supported',
          sandboxId: '',
          provider: 'gateway'
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
          provider: 'gateway'
        }, { status: 400 });
      }
      
      // Execute the action and return Response
      const result = await executeAction(body);
      return Response.json(result, {
        status: result.success ? 200 : 500
      });
    } else {
      // Direct body passed - return result directly
      body = requestOrBody;
      return await executeAction(body);
    }
    
  } catch (error) {
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Request handling failed',
      sandboxId: '',
      provider: 'gateway'
    };
    
    if (requestOrBody instanceof Request) {
      return Response.json(errorResponse, { status: 500 });
    } else {
      return errorResponse;
    }
  }
}

/**
 * Parameters for handleComputeRequest
 */
export interface HandleComputeRequestParams {
  request: ComputeRequest;
}

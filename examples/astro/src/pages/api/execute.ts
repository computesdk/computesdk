import type { APIRoute } from 'astro';
import { ComputeSDK } from 'computesdk';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { code, runtime = 'python' } = await request.json();

    if (!code || typeof code !== 'string') {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Code is required and must be a string' 
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const sandbox = ComputeSDK.createSandbox({});
    const result = await sandbox.execute(code, runtime);

    return new Response(
      JSON.stringify({
        success: true,
        result: {
          output: result.stdout,
          error: result.stderr,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
          provider: result.provider
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Execution error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
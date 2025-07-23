// @ts-nocheck
import { json, error } from '@sveltejs/kit';
import { ComputeSDK } from 'computesdk';

export const POST = async ({ request }) => {
  try {
    const { code, runtime = 'python' } = await request.json();

    if (!code || typeof code !== 'string') {
      throw error(400, 'Code is required and must be a string');
    }

    const sandbox = ComputeSDK.createSandbox({});
    const result = await sandbox.execute(code, runtime);

    return json({
      success: true,
      result: {
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        provider: result.provider
      }
    });
  } catch (err) {
    console.error('Execution error:', err);
    
    throw error(500, err instanceof Error ? err.message : 'Unknown error occurred');
  }
};
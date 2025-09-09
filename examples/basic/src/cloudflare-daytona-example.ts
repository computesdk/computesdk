/**
 * Cloudflare Worker with Daytona Provider Example
 * 
 * This example shows how to use the Daytona provider within a Cloudflare Worker.
 * The worker will execute all the same examples as the standalone Daytona example
 * when receiving HTTP requests.
 * 
 * Prerequisites:
 * - Set DAYTONA_API_KEY environment variable in Cloudflare Worker secrets
 * - Deploy this as a Cloudflare Worker
 */

import { daytona } from '@computesdk/daytona';
import { compute } from 'computesdk';

interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }  

export interface Env {
  DAYTONA_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Check if Daytona API key is available
      if (!env.DAYTONA_API_KEY) {
        return new Response(
          JSON.stringify({
            error: 'Missing DAYTONA_API_KEY',
            message: 'Please set your Daytona API key in Cloudflare Worker secrets'
          }),
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Configure compute with Daytona provider
      compute.setConfig({ 
        provider: daytona({ apiKey: env.DAYTONA_API_KEY }) 
      });

      // Create sandbox using compute singleton
      const sandbox = await compute.sandbox.create();

      console.log('Created Daytona sandbox:', sandbox.sandboxId);

      const results: any = {
        sandboxId: sandbox.sandboxId,
        sections: {}
      };

      // 1. Basic Python code execution
      console.log('Running basic Python code execution...');
      const basicResult = await sandbox.runCode(`
import sys
print(f"Python version: {sys.version}")
print("Hello from Daytona!")

# Calculate fibonacci
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(5):
    print(f"fibonacci({i}) = {fibonacci(i)}")
      `);

      results.sections.basicExecution = {
        stdout: basicResult.stdout,
        stderr: basicResult.stderr,
        exitCode: basicResult.exitCode,
        executionTime: basicResult.executionTime
      };

      // 2. Get sandbox info
      const info = await sandbox.getInfo();
      results.sections.sandboxInfo = {
        id: info.id,
        runtime: info.runtime,
        status: info.status,
        provider: info.provider
      };

      // 3. Filesystem operations
      console.log('Running filesystem operations...');
      
      // Write and execute a Python script
      await sandbox.filesystem.writeFile('/tmp/script.py', `
def greet(name):
    return f"Hello, {name}!"

print(greet("Daytona"))
print("This script was written via filesystem!")
      `);

      const scriptResult = await sandbox.runCommand('python', ['/tmp/script.py']);
      
      // Create directory and list files
      await sandbox.filesystem.mkdir('/tmp/data');
      const files = await sandbox.filesystem.readdir('/tmp');

      results.sections.filesystem = {
        scriptOutput: scriptResult.stdout,
        filesInTmp: files.map((f: any) => f.name)
      };

      // 4. Data science example
      console.log('Running data science example...');
      const dataResult = await sandbox.runCode(`
import pandas as pd
import numpy as np

# Create sample data
data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print("DataFrame:")
print(df)
print(f"Sum: {df.sum().sum()}")
      `);

      results.sections.dataScience = {
        stdout: dataResult.stdout,
        stderr: dataResult.stderr,
        exitCode: dataResult.exitCode,
        executionTime: dataResult.executionTime
      };

      // 5. Daytona features info
      results.sections.daytonaFeatures = [
        'Fast development environment provisioning',
        'Pre-configured development containers',
        'Integrated development tools',
        'Team collaboration features',
        'Filesystem operations (read/write/mkdir/readdir)',
        'Code execution in isolated environments',
        'No terminal operations (by design)'
      ];

      // Clean up sandbox
      await sandbox.kill();
      console.log('Daytona sandbox terminated successfully');

      // Return response with all execution results
      return new Response(
        JSON.stringify({
          success: true,
          ...results
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Worker error:', errorMessage);

      let errorType = 'unknown';
      let suggestions = [];

      if (errorMessage.includes('API key') || errorMessage.includes('authentication')) {
        errorType = 'authentication';
        suggestions = [
          'Get your Daytona API key from https://daytona.io/',
          'Set it as a Cloudflare Worker secret: wrangler secret put DAYTONA_API_KEY'
        ];
      } else if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
        errorType = 'quota';
        suggestions = [
          'Check your Daytona usage dashboard',
          'Consider upgrading your plan if needed'
        ];
      } else if (errorMessage.includes('not implemented')) {
        errorType = 'not_implemented';
        suggestions = [
          'Some Daytona features are still in development',
          'Check the Daytona documentation for current capabilities'
        ];
      } else {
        suggestions = [
          'Visit: https://daytona.io/docs',
          'Check your network connection',
          'Verify your API key is valid'
        ];
      }

      return new Response(
        JSON.stringify({
          error: 'Execution failed',
          errorType,
          message: errorMessage,
          suggestions
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  },
};

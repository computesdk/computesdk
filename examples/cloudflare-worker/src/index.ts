/**
 * Cloudflare Worker with Daytona Provider Example
 * 
 * This example shows how to use the Daytona provider within a Cloudflare Worker
 * to execute Python code when receiving HTTP requests.
 * 
 * Prerequisites:
 * - Set CLOUDFLARE_API_KEY as a Cloudflare Worker secret
 * - Deploy this as a Cloudflare Worker
 */

import { daytona } from '@computesdk/daytona';
import { compute } from 'computesdk';

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
			compute.setConfig({ provider: daytona({ apiKey: env.DAYTONA_API_KEY }) });

			// Create sandbox using compute singleton
			const sandbox = await compute.sandbox.create();

			console.log('Created Daytona sandbox:', sandbox.sandboxId);

			// Execute Python code in Daytona
			const result = await sandbox.runCode(`
import sys
print(f"Python version: {sys.version}")
print("Hello from Daytona in Cloudflare Worker!")

# Simple calculation
numbers = [1, 2, 3, 4, 5]
total = sum(numbers)
print(f"Sum of {numbers} = {total}")

# Fibonacci sequence
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print("Fibonacci sequence:")
for i in range(6):
    print(f"fib({i}) = {fibonacci(i)}")
			`);

			console.log('Execution result:', result.stdout);

			// Get sandbox info
			const info = await sandbox.getInfo();

			// Clean up sandbox
			await sandbox.kill();
			console.log('Daytona sandbox terminated successfully');

			// Return response with execution results
			return new Response(
				JSON.stringify({
					success: true,
					sandboxId: sandbox.sandboxId,
					execution: {
						stdout: result.stdout,
						stderr: result.stderr,
						exitCode: result.exitCode,
						executionTime: result.executionTime
					},
					sandboxInfo: {
						id: info.id,
						runtime: info.runtime,
						status: info.status,
						provider: info.provider
					}
				}),
				{ 
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('Worker error:', errorMessage);

			return new Response(
				JSON.stringify({
					error: 'Execution failed',
					message: errorMessage
				}),
				{ 
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
	},
} satisfies ExportedHandler<Env>;

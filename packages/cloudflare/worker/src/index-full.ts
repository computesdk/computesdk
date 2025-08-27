/**
 * Cloudflare Sandbox Worker - Real World Test Implementation
 * 
 * This worker demonstrates the @computesdk/cloudflare provider in action.
 * It creates sandboxes, executes code, and provides a REST API for testing.
 */

import { cloudflare } from "@computesdk/cloudflare";

// CRITICAL: Export the Sandbox class for Durable Objects
export { Sandbox } from "@cloudflare/sandbox";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		
		// Add CORS headers for easier testing
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// Route requests based on path
			if (url.pathname === '/') {
				return handleRoot(env, corsHeaders);
			} else if (url.pathname === '/test') {
				return handleTest(env, corsHeaders);
			} else if (url.pathname === '/python') {
				return handlePython(env, corsHeaders);
			} else if (url.pathname === '/node') {
				return handleNode(env, corsHeaders);
			} else if (url.pathname === '/filesystem') {
				return handleFilesystem(env, corsHeaders);
			} else if (url.pathname === '/command') {
				return handleCommand(env, corsHeaders);
			} else {
				return new Response(JSON.stringify({
					error: 'Not Found',
					availableEndpoints: ['/', '/test', '/python', '/node', '/filesystem', '/command']
				}), { 
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				});
			}
		} catch (error) {
			return new Response(JSON.stringify({
				error: 'Internal Server Error',
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			}), { 
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			});
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * Root endpoint - shows API documentation
 */
async function handleRoot(_env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const documentation = {
		title: "Cloudflare Sandbox Worker - Real World Test",
		description: "Testing @computesdk/cloudflare provider with Cloudflare Sandbox SDK",
		endpoints: {
			"/": "This documentation",
			"/test": "Basic sandbox creation and info test",
			"/python": "Execute Python code in sandbox",
			"/node": "Execute Node.js/JavaScript code in sandbox", 
			"/filesystem": "Test filesystem operations",
			"/command": "Execute shell commands"
		},
		setup: {
			durableObjects: "✓ Configured",
			containers: "✓ Configured",
			provider: "@computesdk/cloudflare",
			sdkVersion: "@cloudflare/sandbox v0.3.0"
		}
	};

	return new Response(JSON.stringify(documentation, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

/**
 * Basic test endpoint - creates sandbox and gets info
 */
async function handleTest(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const provider = cloudflare({
		sandboxBinding: env.Sandbox,
		runtime: 'python',
		timeout: 30000
	});

	const sandbox = await provider.sandbox.create();
	const info = await sandbox.getInfo();

	return new Response(JSON.stringify({
		success: true,
		message: "Sandbox created and tested successfully!",
		sandboxId: sandbox.sandboxId,
		provider: sandbox.provider,
		info: info,
		timestamp: new Date().toISOString()
	}, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

/**
 * Python code execution test
 */
async function handlePython(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const provider = cloudflare({
		sandboxBinding: env.Sandbox,
		runtime: 'python'
	});

	const sandbox = await provider.sandbox.create();
	
	const result = await sandbox.runCode(`
import sys
import json
import datetime

# Test Python execution
data = {
	"message": "Hello from Python in Cloudflare Sandbox!",
	"python_version": sys.version,
	"timestamp": datetime.datetime.now().isoformat(),
	"platform": sys.platform,
	"executable": sys.executable
}

print(json.dumps(data, indent=2))
print("Python execution successful!")
`);

	return new Response(JSON.stringify({
		success: true,
		language: "python",
		execution: {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			executionTime: result.executionTime,
			provider: result.provider
		},
		sandboxId: sandbox.sandboxId
	}, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

/**
 * Node.js/JavaScript code execution test
 */
async function handleNode(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const provider = cloudflare({
		sandboxBinding: env.Sandbox,
		runtime: 'node'
	});

	const sandbox = await provider.sandbox.create();
	
	const result = await sandbox.runCode(`
const data = {
	message: "Hello from Node.js in Cloudflare Sandbox!",
	nodeVersion: process.version,
	platform: process.platform,
	timestamp: new Date().toISOString(),
	uptime: process.uptime()
};

console.log(JSON.stringify(data, null, 2));
console.log("Node.js execution successful!");
`);

	return new Response(JSON.stringify({
		success: true,
		language: "javascript/node",
		execution: {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			executionTime: result.executionTime,
			provider: result.provider
		},
		sandboxId: sandbox.sandboxId
	}, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

/**
 * Filesystem operations test
 */
async function handleFilesystem(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const provider = cloudflare({
		sandboxBinding: env.Sandbox
	});

	const sandbox = await provider.sandbox.create();
	
	// Test filesystem operations
	const testFile = '/tmp/cloudflare-test.txt';
	const testDir = '/tmp/test-directory';
	const testContent = `Hello from Cloudflare Sandbox filesystem!
Created at: ${new Date().toISOString()}
Sandbox ID: ${sandbox.sandboxId}`;

	// Create directory
	await sandbox.filesystem.mkdir(testDir);
	
	// Write file
	await sandbox.filesystem.writeFile(testFile, testContent);
	
	// Read file back
	const readContent = await sandbox.filesystem.readFile(testFile);
	
	// Check if file exists
	const fileExists = await sandbox.filesystem.exists(testFile);
	const dirExists = await sandbox.filesystem.exists(testDir);
	
	// List directory contents
	const tmpContents = await sandbox.filesystem.readdir('/tmp');

	return new Response(JSON.stringify({
		success: true,
		filesystem: {
			operations: {
				mkdir: "✓ Directory created",
				writeFile: "✓ File written", 
				readFile: "✓ File read",
				exists: "✓ Existence checked"
			},
			results: {
				fileExists,
				dirExists,
				readContent: readContent.substring(0, 100) + "...",
				tmpContents: tmpContents.map(f => ({
					name: f.name,
					isDirectory: f.isDirectory,
					size: f.size
				}))
			}
		},
		sandboxId: sandbox.sandboxId
	}, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

/**
 * Shell command execution test
 */
async function handleCommand(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	const provider = cloudflare({
		sandboxBinding: env.Sandbox
	});

	const sandbox = await provider.sandbox.create();
	
	// Test various shell commands
	const commands = [
		{ name: "pwd", command: "pwd", args: [] },
		{ name: "ls", command: "ls", args: ["-la", "/"] },
		{ name: "whoami", command: "whoami", args: [] },
		{ name: "uname", command: "uname", args: ["-a"] },
		{ name: "env", command: "env", args: [] }
	];

	const results = [];
	
	for (const cmd of commands) {
		try {
			const result = await sandbox.runCommand(cmd.command, cmd.args);
			results.push({
				name: cmd.name,
				command: `${cmd.command} ${cmd.args.join(' ')}`.trim(),
				stdout: result.stdout.substring(0, 200) + (result.stdout.length > 200 ? "..." : ""),
				stderr: result.stderr,
				exitCode: result.exitCode,
				executionTime: result.executionTime
			});
		} catch (error) {
			results.push({
				name: cmd.name,
				command: `${cmd.command} ${cmd.args.join(' ')}`.trim(),
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return new Response(JSON.stringify({
		success: true,
		commands: results,
		sandboxId: sandbox.sandboxId
	}, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

export interface Env {
	Sandbox: DurableObjectNamespace; // The Durable Object binding for sandbox
}
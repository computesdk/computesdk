/**
 * Simplified Cloudflare Sandbox Worker - Initial Test Implementation
 * 
 * This version tests the basic provider setup without requiring containers.
 * Use this for initial testing and configuration validation.
 */

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
				return handleRoot(corsHeaders);
			} else if (url.pathname === '/test-binding') {
				return handleTestBinding(env, corsHeaders);
			} else if (url.pathname === '/health') {
				return handleHealth(corsHeaders);
			} else {
				return new Response(JSON.stringify({
					error: 'Not Found',
					availableEndpoints: ['/', '/test-binding', '/health'],
					message: 'This is a simplified test version without containers'
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
async function handleRoot(corsHeaders: Record<string, string>): Promise<Response> {
	const documentation = {
		title: "Cloudflare Sandbox Worker - Simplified Test",
		description: "Testing basic Cloudflare Workers + Durable Objects setup",
		status: "Container-free testing mode",
		endpoints: {
			"/": "This documentation",
			"/test-binding": "Test Durable Object binding",
			"/health": "Health check"
		},
		setup: {
			durableObjects: "✓ Configured",
			containers: "✗ Not required for this test",
			worker: "✓ Running",
			timestamp: new Date().toISOString()
		}
	};

	return new Response(JSON.stringify(documentation, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

/**
 * Test Durable Object binding
 */
async function handleTestBinding(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
	try {
		// Test if the Durable Object binding is working
		const hasBinding = !!env.Sandbox;
		
		let bindingTest = "✗ Binding not found";
		if (hasBinding) {
			// Try to get a Durable Object ID to test the binding
			try {
				const id = env.Sandbox.idFromName("test-sandbox");
				bindingTest = `✓ Binding works - ID: ${id.toString().substring(0, 20)}...`;
			} catch (error) {
				bindingTest = `⚠ Binding exists but failed to create ID: ${error instanceof Error ? error.message : String(error)}`;
			}
		}

		return new Response(JSON.stringify({
			success: hasBinding,
			binding: {
				exists: hasBinding,
				name: "Sandbox",
				type: "DurableObjectNamespace",
				test: bindingTest
			},
			environment: {
				hasEnv: !!env,
				keys: Object.keys(env).filter(key => key !== 'Sandbox')
			},
			timestamp: new Date().toISOString()
		}, null, 2), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	} catch (error) {
		return new Response(JSON.stringify({
			success: false,
			error: error instanceof Error ? error.message : String(error),
			message: "Durable Object binding test failed"
		}, null, 2), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}
}

/**
 * Health check endpoint
 */
async function handleHealth(corsHeaders: Record<string, string>): Promise<Response> {
	return new Response(JSON.stringify({
		status: "healthy",
		worker: "running",
		timestamp: new Date().toISOString(),
		uptime: "N/A (stateless)",
		version: "simplified-test-v1"
	}, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

export interface Env {
	Sandbox: DurableObjectNamespace; // The Durable Object binding for sandbox
}
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Cloudflare Worker Tests', () => {
	it('worker responds with documentation', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env as any);
		await waitOnExecutionContext(ctx);
		
		expect(response.status).toBe(200);
		const data = await response.json() as any;
		expect(data.title).toContain('Cloudflare Sandbox Worker');
	});

	it('worker health check works', async () => {
		const response = await SELF.fetch('https://example.com/health');
		expect(response.status).toBe(200);
		
		const data = await response.json() as any;
		expect(data.status).toBe('healthy');
		expect(data.worker).toBe('running');
	});
	
	it('worker can test Durable Object binding', async () => {
		const response = await SELF.fetch('https://example.com/test-binding');
		expect(response.status).toBe(200);
		
		const data = await response.json() as any;
		expect(data.success).toBe(true);
		expect(data.binding.exists).toBe(true);
	});
});

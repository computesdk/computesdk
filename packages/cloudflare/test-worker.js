/**
 * Test Worker for Miniflare
 * Simple worker that provides mock Durable Object bindings for testing
 */

export class SandboxDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    // Simulate sandbox operations
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', provider: 'cloudflare-miniflare' }));
    }
    
    if (url.pathname === '/sandbox/create') {
      return new Response(JSON.stringify({ 
        sandboxId: 'miniflare-sandbox-' + Date.now(),
        status: 'created' 
      }));
    }
    
    // Default response
    return new Response(JSON.stringify({ 
      message: 'Miniflare test worker',
      timestamp: Date.now()
    }));
  }
}

export default {
  async fetch() {
    return new Response('Hello from Miniflare test worker!');
  }
};
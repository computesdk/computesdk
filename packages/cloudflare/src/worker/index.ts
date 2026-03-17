/**
 * ComputeSDK Cloudflare Gateway Worker
 *
 * Deployed to the user's Cloudflare account via `npx @computesdk/cloudflare`.
 * Exposes a REST API that proxies operations to a Sandbox Durable Object,
 * allowing ComputeSDK to create and manage sandboxes remotely.
 */

import { getSandbox, proxyToSandbox, type Sandbox } from '@cloudflare/sandbox';
export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  SANDBOX_SECRET: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route preview URL traffic to exposed sandbox ports
    const proxy = await proxyToSandbox(request, env);
    if (proxy) return proxy;

    const url = new URL(request.url);

    // Health check (no auth required)
    if (url.pathname === '/v1/health') {
      return Response.json({ status: 'ok', provider: 'cloudflare' });
    }

    // Auth check
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.SANDBOX_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: Record<string, any> = {};
    if (request.method === 'POST') {
      try {
        body = await request.json() as Record<string, any>;
      } catch {
        return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
      }
    }

    const sandboxId = body.sandboxId || url.searchParams.get('sandboxId');
    if (!sandboxId) {
      return Response.json({ error: 'Missing sandboxId' }, { status: 400 });
    }

    try {
      const sandbox = getSandbox(env.Sandbox, sandboxId);

      // --- Sandbox lifecycle ---

      if (url.pathname === '/v1/sandbox/create') {
        if (body.envVars) await sandbox.setEnvVars(body.envVars);
        return Response.json({ sandboxId, status: 'running' });
      }

      if (url.pathname === '/v1/sandbox/destroy') {
        await sandbox.destroy();
        return Response.json({ success: true });
      }

      if (url.pathname === '/v1/sandbox/info') {
        const processes = await sandbox.listProcesses();
        return Response.json({ sandboxId, status: 'running', processes });
      }

      // --- Command execution ---

      if (url.pathname === '/v1/sandbox/exec') {
        if (!body.command) return Response.json({ error: 'Missing required field: command' }, { status: 400 });
        const result = await sandbox.exec(body.command, {
          cwd: body.cwd,
          env: body.env,
          timeout: body.timeout,
        });
        return Response.json(result);
      }

      // --- Code interpreter ---

      if (url.pathname === '/v1/sandbox/runCode') {
        if (!body.code) return Response.json({ error: 'Missing required field: code' }, { status: 400 });
        const result = await sandbox.runCode(body.code, {
          language: body.language,
          timeout: body.timeout,
        });
        return Response.json(result);
      }

      // --- Filesystem ---

      if (url.pathname === '/v1/sandbox/readFile') {
        if (!body.path) return Response.json({ error: 'Missing required field: path' }, { status: 400 });
        const file = await sandbox.readFile(body.path);
        return Response.json(file);
      }

      if (url.pathname === '/v1/sandbox/writeFile') {
        if (!body.path) return Response.json({ error: 'Missing required field: path' }, { status: 400 });
        if (body.content === undefined) return Response.json({ error: 'Missing required field: content' }, { status: 400 });
        await sandbox.writeFile(body.path, body.content);
        return Response.json({ success: true });
      }

      if (url.pathname === '/v1/sandbox/mkdir') {
        if (!body.path) return Response.json({ error: 'Missing required field: path' }, { status: 400 });
        await sandbox.mkdir(body.path, { recursive: true });
        return Response.json({ success: true });
      }

      if (url.pathname === '/v1/sandbox/exists') {
        if (!body.path) return Response.json({ error: 'Missing required field: path' }, { status: 400 });
        const result = await sandbox.exists(body.path);
        return Response.json(result);
      }

      if (url.pathname === '/v1/sandbox/deleteFile') {
        if (!body.path) return Response.json({ error: 'Missing required field: path' }, { status: 400 });
        await sandbox.deleteFile(body.path);
        return Response.json({ success: true });
      }

      // --- Ports ---

      if (url.pathname === '/v1/sandbox/exposePort') {
        if (!body.port) return Response.json({ error: 'Missing required field: port' }, { status: 400 });
        const result = await sandbox.exposePort(body.port, body.options || {});
        return Response.json(result);
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }
  },
};

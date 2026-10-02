/**
 * ComputeSDK ChatGPT plugin — remote MCP server (streamable HTTP, stateless).
 *
 * Auth model (scaffold): every request must carry `Authorization: Bearer
 * <token>`; the token only identifies the user (its SHA-256 is the vault key)
 * and is never logged. A production deployment should validate real OAuth
 * tokens issued for this connector and terminate TLS upstream.
 */

import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CredentialVault } from './vault.js';
import { registerTools } from './tools.js';

const PORT = Number(process.env.PORT ?? 8787);
const vault = new CredentialVault();

function bearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname !== '/mcp' || req.method !== 'POST') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="computesdk"' });
    res.end(JSON.stringify({ error: 'missing_bearer_token' }));
    return;
  }

  const mcpServer = new McpServer(
    { name: 'computesdk-sandbox', version: '0.1.0' },
    {
      instructions:
        'This plugin places compute sandboxes on ComputeSDK\'s hosted gateway: ' +
        'by default they run first-party, billed to the caller\'s ComputeSDK account ' +
        'balance (their bearer token is the API key) — just call create_sandbox. ' +
        'BYOK providers are opt-in for technical users via set_provider_credentials. ' +
        'Use run_command for short work and start_process/wait_process for long-running jobs.',
    }
  );
  registerTools(mcpServer, { userId: CredentialVault.userIdForToken(token), token, vault });

  // Stateless: a fresh server+transport per request — no session resumability.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    mcpServer.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
    console.error('[mcp] request failed:', err instanceof Error ? err.message : err);
  }
});

server.listen(PORT, () => {
  console.log(`computesdk chatgpt plugin listening on :${PORT} (POST /mcp, GET /healthz)`);
});

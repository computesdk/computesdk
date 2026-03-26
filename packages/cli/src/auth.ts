/**
 * Browser-based CLI authentication flow
 *
 * Precedence: env var > stored credentials > browser auth flow
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'os';
import * as p from '@clack/prompts';
import pc from 'picocolors';

function getCredentialsDir(): string {
  return path.join(os.homedir(), '.computesdk');
}

function getCredentialsFile(): string {
  return path.join(getCredentialsDir(), 'credentials.json');
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CONSOLE_AUTH_URL = 'https://console.computesdk.com/cli/auth';

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>ComputeSDK CLI</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h1>Authenticated</h1>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;

/**
 * Load stored credentials from ~/.computesdk/credentials.json.
 * Returns the API key if found and valid, or null.
 */
export function loadStoredCredentials(): string | null {
  try {
    if (!fs.existsSync(getCredentialsFile())) {
      return null;
    }
    const raw = fs.readFileSync(getCredentialsFile(), 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data.apiKey === 'string' && data.apiKey.length > 0) {
      return data.apiKey;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store credentials to ~/.computesdk/credentials.json.
 * Creates ~/.computesdk/ directory if it doesn't exist.
 */
export function storeCredentials(apiKey: string): void {
  if (!fs.existsSync(getCredentialsDir())) {
    fs.mkdirSync(getCredentialsDir(), { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(
    getCredentialsFile(),
    JSON.stringify({ apiKey }, null, 2) + '\n',
    { mode: 0o600 }
  );
}

/**
 * Delete stored credentials file.
 */
export function clearStoredCredentials(): void {
  try {
    if (fs.existsSync(getCredentialsFile())) {
      fs.unlinkSync(getCredentialsFile());
    }
  } catch {
    // Ignore - file may not exist or may not be writable
  }
}

/**
 * Open a URL in the user's default browser.
 * Falls back to printing the URL if the browser fails to open.
 */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) {
      p.log.warn('Could not open browser automatically.');
      p.log.info(`Open this URL manually:\n  ${pc.cyan(url)}`);
    }
  });
}

export interface AuthFlowOptions {
  /** Override timeout for tests */
  timeoutMs?: number;
  /** Callback when server is listening (for tests) */
  onServerReady?: (port: number, state: string) => void;
  /** Skip opening browser (for tests) */
  skipBrowserOpen?: boolean;
}

/**
 * Run the browser-based authentication flow.
 *
 * 1. Start a local HTTP server on a random port
 * 2. Open browser to console.computesdk.com/cli/auth
 * 3. Wait for callback with token and validated state
 * 4. Return the API key
 */
export function runBrowserAuthFlow(options?: AuthFlowOptions): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? AUTH_TIMEOUT_MS;
  const state = crypto.randomBytes(32).toString('hex');

  return new Promise<string>((resolve, reject) => {
    const server = http.createServer();

    const timeout = setTimeout(() => {
      server.close();
      reject(
        new Error('Authentication timed out after 5 minutes. Please try again.')
      );
    }, timeoutMs);

    server.on('request', (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');

      if (req.method !== 'GET' || url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const receivedState = url.searchParams.get('state');
      const token = url.searchParams.get('token');

      if (receivedState !== state) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Error: State mismatch. Please try authenticating again.');
        return;
      }

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Error: No token received.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SUCCESS_HTML);

      clearTimeout(timeout);
      server.close();
      resolve(token);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        clearTimeout(timeout);
        server.close();
        reject(new Error('Failed to start auth server'));
        return;
      }

      const port = addr.port;
      const authUrl = `${CONSOLE_AUTH_URL}?port=${port}&state=${state}`;

      if (options?.onServerReady) {
        options.onServerReady(port, state);
      }

      if (!options?.skipBrowserOpen) {
        openBrowser(authUrl);
      }
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Auth server error: ${err.message}`));
    });
  });
}

/**
 * Resolve an API key through the precedence chain:
 *   env var > stored credentials > browser auth flow
 */
export async function resolveApiKey(options?: {
  forceLogin?: boolean;
}): Promise<string> {
  // 1. Check environment variable (highest precedence)
  if (process.env.COMPUTESDK_API_KEY) {
    return process.env.COMPUTESDK_API_KEY;
  }

  // 2. Check stored credentials (skip if forcing re-auth)
  if (!options?.forceLogin) {
    const stored = loadStoredCredentials();
    if (stored) {
      p.log.info(
        `Using stored credentials from ${pc.dim('~/.computesdk/credentials.json')}`
      );
      return stored;
    }
  }

  // 3. Run browser auth flow
  p.log.info('No API key found. Starting browser authentication...');

  const spinner = p.spinner();
  spinner.start('Waiting for browser authentication...');

  try {
    const apiKey = await runBrowserAuthFlow();
    spinner.stop('Authentication successful');

    // Store for next time
    try {
      storeCredentials(apiKey);
      p.log.success(
        `Credentials saved to ${pc.dim('~/.computesdk/credentials.json')}`
      );
    } catch {
      p.log.warn('Could not save credentials to disk. You may need to authenticate again next time.');
    }

    return apiKey;
  } catch (error) {
    spinner.stop(pc.red('Authentication failed'));
    throw error;
  }
}

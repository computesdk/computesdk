import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'os';
import http from 'node:http';

// Fixed test home path (vi.mock is hoisted, so we can't use variables)
const TEST_HOME = path.join(os.tmpdir(), 'create-compute-test');

// Mock os module so auth.ts uses our test home directory
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  const testHome = actual.tmpdir() + '/create-compute-test';
  return { ...actual, default: actual, homedir: () => testHome };
});

// Mock @clack/prompts to avoid interactive output in tests
vi.mock('@clack/prompts', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  spinner: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

import {
  loadStoredCredentials,
  storeCredentials,
  clearStoredCredentials,
  runBrowserAuthFlow,
  resolveApiKey,
} from '../auth.js';

const CREDENTIALS_DIR = path.join(TEST_HOME, '.computesdk');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

function makeRequest(
  port: number,
  reqPath: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${reqPath}`, (res) => {
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode || 0, body })
      );
    });
    req.on('error', reject);
  });
}

beforeEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('loadStoredCredentials', () => {
  it('returns null when file does not exist', () => {
    expect(loadStoredCredentials()).toBeNull();
  });

  it('returns apiKey when valid credentials file exists', () => {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    fs.writeFileSync(
      CREDENTIALS_FILE,
      JSON.stringify({ apiKey: 'computesdk_live_test123' })
    );
    expect(loadStoredCredentials()).toBe('computesdk_live_test123');
  });

  it('returns null when JSON is malformed', () => {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    fs.writeFileSync(CREDENTIALS_FILE, 'not json');
    expect(loadStoredCredentials()).toBeNull();
  });

  it('returns null when apiKey field is missing', () => {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ other: 'field' }));
    expect(loadStoredCredentials()).toBeNull();
  });

  it('returns null when apiKey is empty string', () => {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ apiKey: '' }));
    expect(loadStoredCredentials()).toBeNull();
  });
});

describe('storeCredentials', () => {
  it('creates directory and writes credentials file', () => {
    storeCredentials('computesdk_live_abc');
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.apiKey).toBe('computesdk_live_abc');
  });

  it('overwrites existing credentials', () => {
    storeCredentials('computesdk_live_first');
    storeCredentials('computesdk_live_second');
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.apiKey).toBe('computesdk_live_second');
  });
});

describe('clearStoredCredentials', () => {
  it('deletes credentials file', () => {
    storeCredentials('computesdk_live_abc');
    expect(fs.existsSync(CREDENTIALS_FILE)).toBe(true);
    clearStoredCredentials();
    expect(fs.existsSync(CREDENTIALS_FILE)).toBe(false);
  });

  it('does not throw when file does not exist', () => {
    expect(() => clearStoredCredentials()).not.toThrow();
  });
});

describe('runBrowserAuthFlow', () => {
  it('resolves with token on valid callback', async () => {
    const result = runBrowserAuthFlow({
      skipBrowserOpen: true,
      timeoutMs: 5000,
      onServerReady: (port, state) => {
        makeRequest(port, `/callback?token=computesdk_live_test&state=${state}`);
      },
    });

    await expect(result).resolves.toBe('computesdk_live_test');
  });

  it('rejects state mismatch with 403', async () => {
    const result = runBrowserAuthFlow({
      skipBrowserOpen: true,
      timeoutMs: 1000,
      onServerReady: async (port, _state) => {
        const res = await makeRequest(
          port,
          '/callback?token=computesdk_live_test&state=wrong_state'
        );
        expect(res.statusCode).toBe(403);
      },
    });

    // Wrong state doesn't close the server, so it times out
    await expect(result).rejects.toThrow('timed out');
  });

  it('returns 404 for non-callback paths', async () => {
    const result = runBrowserAuthFlow({
      skipBrowserOpen: true,
      timeoutMs: 5000,
      onServerReady: async (port, state) => {
        const res = await makeRequest(port, '/other-path');
        expect(res.statusCode).toBe(404);

        await makeRequest(
          port,
          `/callback?token=computesdk_live_test&state=${state}`
        );
      },
    });

    await expect(result).resolves.toBe('computesdk_live_test');
  });

  it('returns 400 when token is missing', async () => {
    const result = runBrowserAuthFlow({
      skipBrowserOpen: true,
      timeoutMs: 5000,
      onServerReady: async (port, state) => {
        const res = await makeRequest(port, `/callback?state=${state}`);
        expect(res.statusCode).toBe(400);

        await makeRequest(
          port,
          `/callback?token=computesdk_live_test&state=${state}`
        );
      },
    });

    await expect(result).resolves.toBe('computesdk_live_test');
  });

  it('rejects on timeout', async () => {
    const result = runBrowserAuthFlow({
      skipBrowserOpen: true,
      timeoutMs: 100,
    });

    await expect(result).rejects.toThrow('timed out');
  });
});

describe('resolveApiKey', () => {
  const originalEnv = process.env.COMPUTESDK_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.COMPUTESDK_API_KEY = originalEnv;
    } else {
      delete process.env.COMPUTESDK_API_KEY;
    }
  });

  it('returns env var when COMPUTESDK_API_KEY is set', async () => {
    process.env.COMPUTESDK_API_KEY = 'computesdk_live_from_env';
    const key = await resolveApiKey();
    expect(key).toBe('computesdk_live_from_env');
  });

  it('returns stored credentials when env var is not set', async () => {
    delete process.env.COMPUTESDK_API_KEY;
    storeCredentials('computesdk_live_stored');
    const key = await resolveApiKey();
    expect(key).toBe('computesdk_live_stored');
  });

  it('env var takes precedence over stored credentials', async () => {
    storeCredentials('computesdk_live_stored');
    process.env.COMPUTESDK_API_KEY = 'computesdk_live_from_env';
    const key = await resolveApiKey();
    expect(key).toBe('computesdk_live_from_env');
  });
});

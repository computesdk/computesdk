import { describe, it, expect } from 'vitest';
import { escapeShellArg } from '@computesdk/provider';
import { NorthflankApiCallError } from '@northflank/js-client';
import {
  DEFAULT_KEEP_ALIVE_COMMAND,
  extractStatus,
  generateServiceName,
  imageForRuntime,
  is404,
  isAuthError,
  isFileNotFound,
  isPermanentClientError,
  isValidEnvKey,
  mapStatus,
  normalizePort,
  parseRuntime,
  prefix,
  projectParams,
  serviceParams,
  type NorthflankConfig,
} from '../utils';

const baseConfig = (over: Partial<NorthflankConfig> = {}): NorthflankConfig => ({
  token: 't',
  projectId: 'p',
  ...over,
});

describe('prefix', () => {
  it('returns "computesdk-" by default', () => {
    expect(prefix(baseConfig())).toBe('computesdk-');
  });

  it('honors a custom servicePrefix', () => {
    expect(prefix(baseConfig({ servicePrefix: 'csdk-' }))).toBe('csdk-');
  });
});

describe('projectParams / serviceParams', () => {
  it('omits teamId when not set', () => {
    expect(projectParams(baseConfig())).toEqual({ projectId: 'p' });
    expect(serviceParams(baseConfig(), 'svc')).toEqual({ projectId: 'p', serviceId: 'svc' });
  });

  it('includes teamId when present', () => {
    expect(projectParams(baseConfig({ teamId: 'tm' }))).toEqual({ teamId: 'tm', projectId: 'p' });
    expect(serviceParams(baseConfig({ teamId: 'tm' }), 'svc')).toEqual({
      teamId: 'tm',
      projectId: 'p',
      serviceId: 'svc',
    });
  });
});

describe('parseRuntime', () => {
  it.each(['node', 'python', 'go', 'rust', 'bash', 'custom-thing'])(
    'passes through arbitrary string %s',
    (value) => {
      expect(parseRuntime(value)).toBe(value);
    },
  );

  it.each([undefined, null, '', 42, {}])('defaults to "node" for falsy / non-string %p', (value) => {
    expect(parseRuntime(value)).toBe('node');
  });
});

describe('normalizePort', () => {
  it('expands a bare port number to a default NorthflankPort', () => {
    expect(normalizePort(3000)).toEqual({
      name: 'p3000',
      internalPort: 3000,
      public: true,
      protocol: 'HTTP',
    });
  });

  it('passes a NorthflankPort object through untouched', () => {
    const port = { name: 'app', internalPort: 8080, public: false, protocol: 'TCP' as const };
    expect(normalizePort(port)).toBe(port);
  });
});

describe('mapStatus', () => {
  it('FAILED → error (even when paused)', () => {
    expect(mapStatus('FAILED', false)).toBe('error');
    expect(mapStatus('FAILED', true)).toBe('error');
  });

  it('paused → stopped (unless FAILED)', () => {
    expect(mapStatus('COMPLETED', true)).toBe('stopped');
    expect(mapStatus('IN_PROGRESS', true)).toBe('stopped');
    expect(mapStatus(undefined, true)).toBe('stopped');
  });

  it('COMPLETED + not paused → running', () => {
    expect(mapStatus('COMPLETED', false)).toBe('running');
    expect(mapStatus('COMPLETED', undefined)).toBe('running');
  });

  it.each(['PENDING', 'IN_PROGRESS', undefined, 'UNKNOWN'])('%s → stopped', (status) => {
    expect(mapStatus(status, false)).toBe('stopped');
  });
});

describe('DEFAULT_KEEP_ALIVE_COMMAND', () => {
  it('is "sleep infinity"', () => {
    expect(DEFAULT_KEEP_ALIVE_COMMAND).toBe('sleep infinity');
  });
});

describe('imageForRuntime', () => {
  it('returns the runtime default when no override given', () => {
    expect(imageForRuntime('node')).toBe('node:20-slim');
    expect(imageForRuntime('python')).toBe('python:3.11-slim');
  });

  it('returns the override when supplied (overrides even known defaults)', () => {
    expect(imageForRuntime('node', 'node:22-alpine')).toBe('node:22-alpine');
    expect(imageForRuntime('go', 'golang:1.22')).toBe('golang:1.22');
  });

  it('throws for an unknown runtime with no override', () => {
    expect(() => imageForRuntime('go')).toThrow(/No default image for runtime 'go'/);
    expect(() => imageForRuntime('rust')).toThrow(/provide config\.image or internalDeployment/);
  });
});

describe('generateServiceName', () => {
  it('uses the custom name when given and already prefixed', () => {
    expect(generateServiceName('csdk-', 'csdk-already')).toBe('csdk-already');
  });

  it('prepends the prefix when custom name is bare', () => {
    expect(generateServiceName('csdk-', 'sandbox')).toBe('csdk-sandbox');
  });

  it('falls back to a timestamped+random suffix', () => {
    const name = generateServiceName('csdk-');
    expect(name).toMatch(/^csdk-\d+-[a-z0-9]{6}$/);
  });
});

describe('isValidEnvKey', () => {
  it.each(['FOO', '_FOO', 'foo_bar', 'A1', '__init__'])('accepts %s', (key) => {
    expect(isValidEnvKey(key)).toBe(true);
  });

  it.each(['', '1FOO', 'FOO-BAR', 'foo bar', 'FOO=BAR', 'FOO;rm -rf /'])('rejects %s', (key) => {
    expect(isValidEnvKey(key)).toBe(false);
  });
});

describe('is404', () => {
  it('returns true for NorthflankApiCallError with status 404', () => {
    const err = new NorthflankApiCallError({ status: 404, message: 'service not found' });
    expect(is404(err)).toBe(true);
  });

  it('returns false for NorthflankApiCallError with other statuses', () => {
    for (const status of [400, 401, 403, 500, 502]) {
      const err = new NorthflankApiCallError({ status, message: 'other error' });
      expect(is404(err)).toBe(false);
    }
  });

  it('falls back to message sniffing for non-typed errors', () => {
    expect(is404(new Error('Service returned 404'))).toBe(true);
    expect(is404(new Error('not found in cluster'))).toBe(true);
    expect(is404(new Error('Internal Server Error'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(is404(null)).toBe(false);
    expect(is404(undefined)).toBe(false);
    expect(is404('404')).toBe(false);
    expect(is404({ status: 404 })).toBe(false);
  });

  it('extracts WS status from "Unexpected server response: NNN" messages', () => {
    expect(is404(new Error('WebSocket error: Unexpected server response: 404'))).toBe(true);
    expect(is404(new Error('Command execution failed: WebSocket error: Unexpected server response: 404'))).toBe(true);
    expect(is404(new Error('Unexpected server response: 500'))).toBe(false);
  });
});

describe('extractStatus', () => {
  it('returns NorthflankApiCallError.status when present', () => {
    expect(extractStatus(new NorthflankApiCallError({ status: 404, message: 'x' }))).toBe(404);
    expect(extractStatus(new NorthflankApiCallError({ status: 500, message: 'x' }))).toBe(500);
  });

  it('parses WS error message format "Unexpected server response: NNN"', () => {
    expect(extractStatus(new Error('Command execution failed: WebSocket error: Unexpected server response: 500'))).toBe(500);
    expect(extractStatus(new Error('Unexpected server response: 401'))).toBe(401);
    expect(extractStatus(new Error('Unexpected server response:404'))).toBe(404); // tolerant of missing space
  });

  it('returns undefined when no status is parseable', () => {
    expect(extractStatus(new Error('socket hang up'))).toBeUndefined();
    expect(extractStatus(new Error('connect ECONNREFUSED'))).toBeUndefined();
    expect(extractStatus(null)).toBeUndefined();
    expect(extractStatus({ status: 404 })).toBeUndefined();  // not an Error instance
  });
});

describe('isAuthError', () => {
  it('matches WS 401/403 in message', () => {
    expect(isAuthError(new Error('Unexpected server response: 401'))).toBe(true);
    expect(isAuthError(new Error('Unexpected server response: 403'))).toBe(true);
    expect(isAuthError(new Error('Unexpected server response: 500'))).toBe(false);
  });
  it('matches NorthflankApiCallError 401/403', () => {
    expect(isAuthError(new NorthflankApiCallError({ status: 401, message: 'x' }))).toBe(true);
    expect(isAuthError(new NorthflankApiCallError({ status: 403, message: 'x' }))).toBe(true);
    expect(isAuthError(new NorthflankApiCallError({ status: 404, message: 'x' }))).toBe(false);
  });
});

describe('isPermanentClientError', () => {
  it('matches WS 400/422 in message', () => {
    expect(isPermanentClientError(new Error('Unexpected server response: 400'))).toBe(true);
    expect(isPermanentClientError(new Error('Unexpected server response: 422'))).toBe(true);
    expect(isPermanentClientError(new Error('Unexpected server response: 500'))).toBe(false);
  });
  it('matches NorthflankApiCallError 400/422', () => {
    expect(isPermanentClientError(new NorthflankApiCallError({ status: 400, message: 'x' }))).toBe(true);
    expect(isPermanentClientError(new NorthflankApiCallError({ status: 422, message: 'x' }))).toBe(true);
    expect(isPermanentClientError(new NorthflankApiCallError({ status: 500, message: 'x' }))).toBe(false);
  });
});

describe('isFileNotFound', () => {
  it('matches missing-file error messages (case-insensitive)', () => {
    expect(isFileNotFound(new Error('file not found: /tmp/x'))).toBe(true);
    expect(isFileNotFound(new Error('Not Found'))).toBe(true);
    expect(isFileNotFound(new Error('ENOENT: open /tmp/x'))).toBe(true);
    expect(isFileNotFound(new Error('stat /tmp/x: No such file or directory'))).toBe(true);
    // Actual @northflank/js-client downloadFiles message for a missing remote path.
    expect(
      isFileNotFound(new Error("Remote path '/nonexistent/file.txt' does not exists but is required for downloads.")),
    ).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isFileNotFound(new Error('Unexpected server response: 500'))).toBe(false);
    expect(isFileNotFound(new Error('socket hang up'))).toBe(false);
    expect(isFileNotFound(null)).toBe(false);
    expect(isFileNotFound(undefined)).toBe(false);
  });
});

describe('escapeShellArg', () => {
  it('passes through a plain string', () => {
    expect(escapeShellArg('hello world')).toBe('hello world');
  });

  it('handles an empty string', () => {
    expect(escapeShellArg('')).toBe('');
  });

  it('escapes the four interpolation-sensitive characters', () => {
    expect(escapeShellArg('\\')).toBe('\\\\');
    expect(escapeShellArg('"')).toBe('\\"');
    expect(escapeShellArg('$')).toBe('\\$');
    expect(escapeShellArg('`')).toBe('\\`');
  });

  it('leaves single quotes alone (only matters inside double-quoted contexts)', () => {
    expect(escapeShellArg("it's a test")).toBe("it's a test");
  });

  it('escapes combinations safely', () => {
    expect(escapeShellArg('say "$NAME" `whoami`')).toBe('say \\"\\$NAME\\" \\`whoami\\`');
  });
});

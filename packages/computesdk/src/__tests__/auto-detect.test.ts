/**
 * Auto-Detection Tests
 * 
 * Tests for provider auto-detection from environment variables
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isGatewayModeEnabled, detectProvider, autoConfigureCompute } from '../auto-detect';

describe('Auto-Detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isGatewayModeEnabled', () => {
    it('returns true when COMPUTESDK_API_KEY is set', () => {
      process.env.COMPUTESDK_API_KEY = 'test_key';
      expect(isGatewayModeEnabled()).toBe(true);
    });

    it('returns false when COMPUTESDK_API_KEY is not set', () => {
      delete process.env.COMPUTESDK_API_KEY;
      expect(isGatewayModeEnabled()).toBe(false);
    });

    it('returns false when COMPUTESDK_API_KEY is empty string', () => {
      process.env.COMPUTESDK_API_KEY = '';
      expect(isGatewayModeEnabled()).toBe(false);
    });
  });

  describe('detectProvider', () => {
    it('detects e2b when E2B_API_KEY is set', () => {
      process.env.E2B_API_KEY = 'test_key';
      expect(detectProvider()).toBe('e2b');
    });

    it('detects railway when all required vars are set', () => {
      process.env.RAILWAY_API_KEY = 'test_key';
      process.env.RAILWAY_PROJECT_ID = 'project';
      process.env.RAILWAY_ENVIRONMENT_ID = 'env';
      expect(detectProvider()).toBe('railway');
    });

    it('does not detect railway when only some vars are set', () => {
      process.env.RAILWAY_API_KEY = 'test_key';
      process.env.RAILWAY_PROJECT_ID = 'project';
      // Missing RAILWAY_ENVIRONMENT_ID
      expect(detectProvider()).toBe(null);
    });

    it('detects daytona when DAYTONA_API_KEY is set', () => {
      process.env.DAYTONA_API_KEY = 'test_key';
      expect(detectProvider()).toBe('daytona');
    });

    it('detects modal when both token vars are set', () => {
      process.env.MODAL_TOKEN_ID = 'id';
      process.env.MODAL_TOKEN_SECRET = 'secret';
      expect(detectProvider()).toBe('modal');
    });

    it('detects runloop when RUNLOOP_API_KEY is set', () => {
      process.env.RUNLOOP_API_KEY = 'test_key';
      expect(detectProvider()).toBe('runloop');
    });

    it('detects vercel when all required vars are set', () => {
      process.env.VERCEL_TOKEN = 'token';
      process.env.VERCEL_TEAM_ID = 'team';
      process.env.VERCEL_PROJECT_ID = 'project';
      expect(detectProvider()).toBe('vercel');
    });

    it('detects cloudflare when both vars are set', () => {
      process.env.CLOUDFLARE_API_TOKEN = 'token';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'account';
      expect(detectProvider()).toBe('cloudflare');
    });

    it('detects codesandbox when CSB_API_KEY is set', () => {
      process.env.CSB_API_KEY = 'test_key';
      expect(detectProvider()).toBe('codesandbox');
    });

    it('detects blaxel when both vars are set', () => {
      process.env.BL_API_KEY = 'key';
      process.env.BL_WORKSPACE = 'workspace';
      expect(detectProvider()).toBe('blaxel');
    });

    it('returns null when no provider vars are set', () => {
      expect(detectProvider()).toBe(null);
    });

    it('respects COMPUTESDK_PROVIDER override', () => {
      process.env.COMPUTESDK_PROVIDER = 'modal';
      process.env.MODAL_TOKEN_ID = 'id';
      process.env.MODAL_TOKEN_SECRET = 'secret';
      process.env.E2B_API_KEY = 'key'; // E2B has higher priority but should be overridden
      expect(detectProvider()).toBe('modal');
    });

    it('falls back to auto-detection if override provider credentials missing', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      process.env.COMPUTESDK_PROVIDER = 'modal';
      // Missing modal credentials
      process.env.E2B_API_KEY = 'key';

      expect(detectProvider()).toBe('e2b');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('COMPUTESDK_PROVIDER is set to "modal"')
      );

      consoleWarnSpy.mockRestore();
    });

    it('follows priority order when multiple providers are configured', () => {
      // Set up multiple providers
      process.env.BL_API_KEY = 'key';
      process.env.BL_WORKSPACE = 'workspace';
      process.env.DAYTONA_API_KEY = 'key';
      process.env.E2B_API_KEY = 'key';

      // E2B should win (highest priority)
      expect(detectProvider()).toBe('e2b');
    });
  });

  describe('autoConfigureCompute', () => {
    it('returns null when gateway mode is not enabled', () => {
      delete process.env.COMPUTESDK_API_KEY;
      expect(autoConfigureCompute()).toBe(null);
    });

    it('throws when gateway mode enabled but no provider detected', () => {
      process.env.COMPUTESDK_API_KEY = 'test_key';

      expect(() => autoConfigureCompute()).toThrow(
        /COMPUTESDK_API_KEY is set but no provider detected/
      );
    });

    it('returns gateway config when properly configured', () => {
      process.env.COMPUTESDK_API_KEY = 'test_key';
      process.env.E2B_API_KEY = 'e2b_key';

      const config = autoConfigureCompute();

      expect(config).toBeDefined();
      expect(config?.provider).toBe('e2b');
      expect(config?.apiKey).toBe('test_key');
      expect(config?.gatewayUrl).toBeDefined();
      expect(config?.providerHeaders).toBeDefined();
    });

    it('validates gateway URL when COMPUTESDK_GATEWAY_URL is set', () => {
      process.env.COMPUTESDK_API_KEY = 'test_key';
      process.env.E2B_API_KEY = 'e2b_key';
      process.env.COMPUTESDK_GATEWAY_URL = 'invalid-url';

      expect(() => autoConfigureCompute()).toThrow(/Invalid gateway URL/);
    });

    it('accepts valid HTTPS gateway URL', () => {
      process.env.COMPUTESDK_API_KEY = 'test_key';
      process.env.E2B_API_KEY = 'e2b_key';
      process.env.COMPUTESDK_GATEWAY_URL = 'https://custom-gateway.example.com';

      const config = autoConfigureCompute();
      expect(config).toBeDefined();
      expect(config?.gatewayUrl).toBe('https://custom-gateway.example.com');
    });

    it('accepts valid HTTP gateway URL', () => {
      process.env.COMPUTESDK_API_KEY = 'test_key';
      process.env.E2B_API_KEY = 'e2b_key';
      process.env.COMPUTESDK_GATEWAY_URL = 'http://localhost:3000';

      const config = autoConfigureCompute();
      expect(config).toBeDefined();
      expect(config?.gatewayUrl).toBe('http://localhost:3000');
    });

    it('shows debug logs when COMPUTESDK_DEBUG is enabled', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

      process.env.COMPUTESDK_API_KEY = 'test_key';
      process.env.E2B_API_KEY = 'e2b_key';
      process.env.COMPUTESDK_DEBUG = 'true';

      autoConfigureCompute();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auto-detected e2b provider')
      );

      consoleLogSpy.mockRestore();
    });
  });
});

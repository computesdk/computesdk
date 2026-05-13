/**
 * Declaw Provider Tests
 *
 * Uses the shared test suite from @computesdk/test-utils to validate
 * all provider functionality including:
 * - Sandbox lifecycle (create, getById, list, destroy)
 * - Code execution (runCode with Python and Node.js)
 * - Command execution (runCommand)
 * - Filesystem operations (read, write, mkdir, readdir, exists, remove)
 *
 * Integration tests require DECLAW_API_KEY environment variable to be set.
 * Tests are skipped if the API key is not available.
 */

import { runProviderTestSuite } from '@computesdk/test-utils';
import { declaw } from '../index';

// Run the shared provider test suite
runProviderTestSuite({
  name: 'declaw',
  // Create provider instance with empty config (will use DECLAW_API_KEY env var)
  provider: declaw({}),
  // Declaw supports native filesystem operations via sandbox.files.*
  supportsFilesystem: true,
  // Skip integration tests if DECLAW_API_KEY is not set
  skipIntegration: !process.env.DECLAW_API_KEY
});

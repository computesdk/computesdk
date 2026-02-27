/**
 * Beam Provider Tests
 *
 * Uses the shared test suite from @computesdk/test-utils to validate
 * all provider functionality including:
 * - Sandbox lifecycle (create, getById, list, destroy)
 * - Code execution (runCode with Python and Node.js)
 * - Command execution (runCommand)
 * - Filesystem operations (read, write, mkdir, readdir, exists, remove)
 *
 * Integration tests require BEAM_TOKEN and BEAM_WORKSPACE_ID environment variables.
 * Tests are skipped if the token is not available.
 */

import { runProviderTestSuite } from '@computesdk/test-utils';
import { beam } from '../index';

// Run the shared provider test suite
runProviderTestSuite({
  name: 'beam',
  // Create provider instance with empty config (will use BEAM_TOKEN env var)
  provider: beam({}),
  // Beam supports filesystem operations via shell commands + native listFiles
  supportsFilesystem: true,
  // Skip integration tests if BEAM_TOKEN is not set
  skipIntegration: !process.env.BEAM_TOKEN,
});

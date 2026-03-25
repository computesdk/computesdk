/**
 * Agentuity Provider Tests
 *
 * Uses the shared test suite from @computesdk/test-utils to validate
 * all provider functionality including:
 * - Sandbox lifecycle (create, getById, list, destroy)
 * - Code execution (runCode with Python and Node.js)
 * - Command execution (runCommand)
 * - Filesystem operations (read, write, mkdir, readdir, exists, remove)
 *
 * Integration tests require AGENTUITY_SDK_KEY environment variable to be set.
 * Tests are skipped if the API key is not available.
 */

import { runProviderTestSuite } from '@computesdk/test-utils';
import { agentuity } from '../index';

// Run the shared provider test suite
runProviderTestSuite({
  name: 'agentuity',
  // Create provider instance with empty config (will use AGENTUITY_SDK_KEY env var)
  provider: agentuity({}),
  // Agentuity supports native filesystem operations via sandbox.files.*
  supportsFilesystem: true,
  // Agentuity requires paths under /home/agentuity/
  filesystemBasePath: '/home/agentuity',
  // Skip integration tests if AGENTUITY_SDK_KEY is not set
  skipIntegration: !process.env.AGENTUITY_SDK_KEY,
});

/**
 * Railway Provider Test Suite
 * 
 * This test suite runs comprehensive tests for the Railway provider using the
 * ComputeSDK test utilities. It automatically switches between:
 * 
 * - MOCK MODE: When API credentials are not available (development/CI)
 *   - Uses mock implementations for all operations
 *   - Tests provider interface and logic without external dependencies
 *   - Safe to run in any environment
 * 
 * - INTEGRATION MODE: When API credentials are available
 *   - Tests against real Railway API endpoints
 *   - Requires the following environment variables:
 *     - RAILWAY_API_KEY: Your Railway API token
 *     - RAILWAY_PROJECT_ID: Your Railway project ID
 *     - RAILWAY_ENVIRONMENT_ID: (Optional) Your Railway environment ID
 * 
 * To run integration tests:
 * 1. Set up Railway account and create a project
 * 2. Export the required environment variables
 * 3. Run: pnpm test
 * 
 * Test Coverage:
 * - ✅ Sandbox creation and management
 * - ✅ Node.js and Python code execution
 * - ✅ Shell command execution (echo, background jobs, etc.)
 * - ✅ Error handling for invalid commands/code
 * - ✅ Filesystem operations (read, write, mkdir, etc.)
 * - ✅ Sandbox info and URL generation
 */

import { runProviderTestSuite } from '@computesdk/test-utils';
import { railway } from '../index';

runProviderTestSuite({
  name: 'railway',
  provider: railway({
    apiKey: process.env.RAILWAY_API_KEY || '',
    projectId: process.env.RAILWAY_PROJECT_ID || '',
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID || 'production',
    tokenType: 'personal'  // Updated to use personal token
  }),
  supportsFilesystem: true,  // Railway supports filesystem operations
  skipIntegration: !process.env.RAILWAY_API_KEY || !process.env.RAILWAY_PROJECT_ID
});
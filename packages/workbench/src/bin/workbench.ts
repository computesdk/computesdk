#!/usr/bin/env node

/**
 * ComputeSDK Workbench CLI Entry Point
 */

import { config } from 'dotenv';
import { startWorkbench } from '../cli/index.js';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from multiple possible locations
const possibleEnvPaths = [
  path.join(process.cwd(), '.env'),           // Current directory
  path.join(process.cwd(), '../../.env'),     // Monorepo root (if running from packages/workbench)
  path.join(__dirname, '../../.env'),         // Relative to this script
];

// Try to load from first existing .env file
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

// Start workbench
startWorkbench().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

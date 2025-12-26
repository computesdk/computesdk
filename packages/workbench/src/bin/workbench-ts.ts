#!/usr/bin/env tsx
/**
 * TypeScript-aware workbench entry point
 * 
 * This version runs with tsx for better TypeScript autocomplete
 */

import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from multiple possible locations
const possibleEnvPaths = [
  path.join(process.cwd(), '.env'),           // Current directory
  path.join(process.cwd(), '../../.env'),     // Monorepo root (if running from packages/workbench)
];

// Try to load from first existing .env file
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

// Start the workbench
import('../cli/index.js').then(({ startWorkbench }) => {
  startWorkbench().catch((error) => {
    console.error('Failed to start workbench:', error);
    process.exit(1);
  });
});

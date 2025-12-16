#!/usr/bin/env tsx
/**
 * TypeScript-aware workbench entry point
 * 
 * This version runs with tsx for better TypeScript autocomplete
 */

import { config } from 'dotenv';

// Load environment variables from .env files
config();

// Start the workbench
import('../cli/index.js').then(({ startWorkbench }) => {
  startWorkbench().catch((error) => {
    console.error('Failed to start workbench:', error);
    process.exit(1);
  });
});

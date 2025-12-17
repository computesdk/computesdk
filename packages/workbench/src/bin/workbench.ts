#!/usr/bin/env node

/**
 * ComputeSDK Workbench CLI Entry Point
 */

import { config } from 'dotenv';
import { startWorkbench } from '../cli/index.js';
import * as path from 'path';

// Load .env from current working directory
config({ path: path.join(process.cwd(), '.env') });

// Start workbench
startWorkbench().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

import { config } from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';

// Load environment variables for test suites
// This ensures providers have access to API credentials during integration tests
function loadTestEnvVars() {
  // Skip if environment variables are already loaded by this package
  if (process.env.COMPUTESDK_TEST_UTILS_ENV_LOADED) {
    return;
  }

  // Try multiple strategies to find and load .env file
  const strategies = [
    // Strategy 1: Monorepo development - look for .env in repo root
    () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (existsSync(envPath)) {
        config({ path: envPath });
        return envPath;
      }
      return null;
    },
    
    // Strategy 2: Look for .env in current working directory and parent directories
    () => {
      let currentDir = process.cwd();
      const maxDepth = 5;
      
      for (let i = 0; i < maxDepth; i++) {
        const envPath = path.join(currentDir, '.env');
        if (existsSync(envPath)) {
          config({ path: envPath });
          return envPath;
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break; // Reached filesystem root
        currentDir = parentDir;
      }
      return null;
    },
    
    // Strategy 3: Default dotenv behavior (process.cwd()/.env)
    () => {
      config(); // Uses default behavior
      const defaultPath = path.join(process.cwd(), '.env');
      return existsSync(defaultPath) ? defaultPath : null;
    }
  ];

  // Try each strategy until one succeeds
  for (const strategy of strategies) {
    const loadedPath = strategy();
    if (loadedPath) {
      // Mark as loaded and exit
      process.env.COMPUTESDK_TEST_UTILS_ENV_LOADED = 'true';
      break;
    }
  }

  // Always mark as attempted to prevent infinite retries
  process.env.COMPUTESDK_TEST_UTILS_ENV_LOADED = 'true';
}

// Load environment variables when this module is imported
loadTestEnvVars();

export * from './provider-test-suite';
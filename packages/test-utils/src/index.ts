import { config } from 'dotenv';
import path from 'path';

// Load environment variables from root .env file for all test suites
// This ensures providers have access to API credentials during integration tests
config({ path: path.resolve(__dirname, '../../../.env') });

export * from './provider-test-suite';
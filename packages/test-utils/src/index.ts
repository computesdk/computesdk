import { config } from 'dotenv';
import path from 'path';

// Load environment variables from root .env file for test suites
// This is specifically for the ComputeSDK monorepo development workflow
config({ path: path.resolve(__dirname, '../../../.env') });

export * from './provider-test-suite';
export * from './provider-crud-test';
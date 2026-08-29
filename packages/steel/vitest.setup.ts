import { config } from 'dotenv';
import path from 'node:path';

// Load the repo-root .env so STEEL_API_KEY is available during tests.
config({ path: path.resolve(__dirname, '../../.env') });

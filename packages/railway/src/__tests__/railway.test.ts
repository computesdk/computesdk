import '@computesdk/test-utils';
import { describe, it, expect } from 'vitest';
import { railway } from '../index';

describe('Railway Provider Integration Test', () => {
  it('should create a sandbox, wait 60 seconds, and destroy it', async () => {
    // Skip test if environment variables are not set
    if (!process.env.RAILWAY_API_KEY || !process.env.RAILWAY_PROJECT_ID || !process.env.RAILWAY_ENVIRONMENT_ID) {
      console.log('Skipping Railway integration test - missing environment variables');
      console.log('Required: RAILWAY_API_KEY, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID');
      return;
    }

    const config = {
      apiKey: process.env.RAILWAY_API_KEY,
      projectId: process.env.RAILWAY_PROJECT_ID,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
    };

    console.log('🚀 Creating Railway sandbox...');
    
    // Create sandbox
    const provider = railway(config);
    const sandbox = await provider.sandbox.create({ runtime: 'node' });
    
    console.log(`✅ Sandbox created with ID: ${sandbox.sandboxId}`);
    
    expect(sandbox).toBeDefined();
    expect(sandbox.sandboxId).toBeDefined();
    expect(typeof sandbox.sandboxId).toBe('string');
    
    // Wait 60 seconds
    console.log('⏰ Waiting 60 seconds...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    console.log('✅ Wait complete');
    
    // Destroy sandbox
    console.log('🗑️  Destroying sandbox...');
    await provider.sandbox.destroy(sandbox.sandboxId);
    console.log('✅ Sandbox destroyed successfully');
    
    // Test passes if no errors are thrown
    expect(true).toBe(true);
  }, 120000); // 2 minute timeout to account for wait time
});
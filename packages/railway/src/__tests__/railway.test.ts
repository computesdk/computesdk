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
    const sandbox = await provider.sandbox.create();
    
    console.log(`✅ Sandbox created with ID: ${sandbox.sandboxId}`);
    
    expect(sandbox).toBeDefined();
    expect(sandbox.sandboxId).toBeDefined();
    expect(typeof sandbox.sandboxId).toBe('string');
    
    // Test getById with existing sandbox
    console.log('🔍 Testing getById method with existing sandbox...');
    const retrievedSandbox = await provider.sandbox.getById(sandbox.sandboxId);
    
    expect(retrievedSandbox).toBeDefined();
    expect(retrievedSandbox!.sandboxId).toBe(sandbox.sandboxId);
    console.log('✅ getById method works with existing sandbox');
    console.log(`📄 Retrieved sandbox details: ID=${retrievedSandbox!.sandboxId}, Provider=${retrievedSandbox!.provider}`);
    
    // Test list method
    console.log('📋 Testing list method...');
    const sandboxList = await provider.sandbox.list();
    
    expect(sandboxList).toBeDefined();
    expect(Array.isArray(sandboxList)).toBe(true);
    // The created sandbox should be in the list
    const foundSandbox = sandboxList.find(s => s.sandboxId === sandbox.sandboxId);
    expect(foundSandbox).toBeDefined();
    expect(foundSandbox!.sandboxId).toBe(sandbox.sandboxId);
    console.log(`✅ list method works - found ${sandboxList.length} sandbox(es), including our created sandbox`);
    
    // Wait 60 seconds
    console.log('⏰ Waiting 60 seconds...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    console.log('✅ Wait complete');
    
    // Destroy sandbox
    console.log('🗑️  Destroying sandbox...');
    await provider.sandbox.destroy(sandbox.sandboxId);
    console.log('✅ Sandbox destroyed successfully');
    
    // Test getById with non-existent sandbox (use invalid ID)
    console.log('🔍 Testing getById method with non-existent sandbox...');
    const nonExistentSandbox = await provider.sandbox.getById('non-existent-service-id');
    
    expect(nonExistentSandbox).toBeNull();
    console.log('✅ getById method correctly returns null for non-existent sandbox');
    
    // Test passes if no errors are thrown
    expect(true).toBe(true);
  }, 120000); // 2 minute timeout to account for wait time
});
import { config } from 'dotenv';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { namespace } from '../index';
import type { NamespaceConfig } from '../index';

// Load environment variables from root .env file for test suites
// This ensures NSC_TOKEN and other environment variables are available
config({ path: path.resolve(__dirname, '../../../../.env') });

describe('Namespace Provider Integration Tests', () => {
  const namespaceConfig: NamespaceConfig = {
    // Token will be picked up from NSC_TOKEN environment variable
    documentedPurpose: 'ComputeSDK Integration Test',
    destroyReason: 'Test cleanup'
  };

  it('should complete full CRUD workflow: create → deploy → getById → list → destroy', async () => {

    console.log('🚀 Starting Namespace provider integration test...');
    const provider = namespace(namespaceConfig);
    let instanceId: string | null = null;

    try {
      // 1. CREATE INSTANCE
      console.log('📦 Step 1: Creating new instance...');
      const created = await provider.sandbox.create({ runtime: 'node' });
      instanceId = created.sandboxId;
      
      expect(created).toBeDefined();
      expect(instanceId).toBeDefined();
      expect(typeof instanceId).toBe('string');
      
      console.log(`✅ Created instance: ${instanceId}`);

      // 2. WAIT FOR IMAGE DEPLOYMENT (60 seconds)
      console.log('⏳ Step 2: Waiting 60 seconds for image deployment...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      console.log('✅ Deployment wait completed');

      // 3. GET BY ID
      console.log('🔍 Step 3: Retrieving instance by ID...');
      const retrieved = await provider.sandbox.getById(instanceId);
      
      expect(retrieved).toBeDefined();
      expect(retrieved!.sandboxId).toBe(instanceId);
      console.log(`✅ Retrieved instance: ${instanceId}`);

      // 4. LIST INSTANCES
      console.log('📋 Step 4: Listing all instances...');
      const allInstances = await provider.sandbox.list();
      
      expect(Array.isArray(allInstances)).toBe(true);
      expect(allInstances.length).toBeGreaterThan(0);
      
      const foundInstance = allInstances.find((instance: any) => instance.sandboxId === instanceId);
      expect(foundInstance).toBeDefined();
      console.log(`✅ Found instance in list of ${allInstances.length} instances`);


      // 5. DESTROY INSTANCE
      console.log('🗑️ Step 5: Destroying instance...');
      await provider.sandbox.destroy(instanceId);
      console.log(`✅ Destroyed instance: ${instanceId}`);
      instanceId = null; // Mark as cleaned up

    } catch (error) {
      console.error('❌ Test failed:', error);
      throw error;
    } finally {
      // Emergency cleanup
      if (instanceId) {
        try {
          console.log('🧹 Performing emergency cleanup...');
          await provider.sandbox.destroy(instanceId);
          console.log('🧹 Emergency cleanup completed');
        } catch (cleanupError) {
          console.warn('⚠️ Emergency cleanup failed:', cleanupError);
        }
      }
    }
  }, 150000); // 150 seconds timeout (30s deploy + API calls + buffer)


  // it('should fail without token', async () => {
  //   const provider = namespace({});
  //   await expect(provider.sandbox.create({ runtime: 'node' }))
  //     .rejects.toThrow('Missing Namespace token.');
  // });
});
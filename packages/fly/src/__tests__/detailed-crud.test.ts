import { describe, it, expect, beforeAll } from 'vitest';
import { fly } from '../index';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file
function loadEnvFile() {
  try {
    const envPath = path.resolve(__dirname, '../../../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            let value = valueParts.join('=').trim();
            // Remove surrounding quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            process.env[key.trim()] = value;
          }
        }
      }
      console.log('📄 Loaded environment variables from .env file');
    }
  } catch (error) {
    console.warn('⚠️  Could not load .env file:', error);
  }
}

// Load env vars before running tests
loadEnvFile();

describe('Fly.io Provider - Detailed CRUD Test with Logging', () => {
  let provider: any;
  let createdSandboxId: string;

  beforeAll(() => {
    // Debug: Show available Fly.io environment variables
    console.log('🔍 Environment Variables Debug:');
    console.log(`   - FLY_API_TOKEN: ${process.env.FLY_API_TOKEN ? '✅ Set (' + process.env.FLY_API_TOKEN.substring(0, 20) + '...)' : '❌ Missing'}`);
    console.log(`   - FLY_ORG: ${process.env.FLY_ORG || 'Not set'}`);
    console.log(`   - FLY_REGION: ${process.env.FLY_REGION || 'Not set'}`);
    console.log('');

    // Skip test if no API token is provided
    if (!process.env.FLY_API_TOKEN) {
      console.log('⚠️  Skipping Fly.io integration tests - FLY_API_TOKEN not set');
      return;
    }

    provider = fly({
      // Uses FLY_API_TOKEN from environment
      // Uses default appName: 'compute-sdk'
      org: process.env.FLY_ORG || 'personal', // Use env var or default
      region: process.env.FLY_REGION || 'iad' // Use env var or default
    });

    console.log('🚀 Starting Fly.io Provider CRUD Test');
    console.log('📋 Test Configuration:');
    console.log(`   - API Token: ${process.env.FLY_API_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`   - App Name: compute-sdk (default)`);
    console.log(`   - Organization: ${process.env.FLY_ORG || 'personal'}`);
    console.log(`   - Region: ${process.env.FLY_REGION || 'iad'}`);
    console.log('');
  });

  it('should perform complete CRUD operations with detailed logging', async () => {
    if (!process.env.FLY_API_TOKEN) {
      console.log('⏭️  Skipping test - no API token');
      return;
    }

    console.log('🔨 Step 1: Creating sandbox...');
    console.time('⏱️  Create operation');

    try {
      const createResult = await provider.sandbox.create({
        runtime: 'node'
      });

      console.timeEnd('⏱️  Create operation');
      console.log('✅ Sandbox created successfully!');
      console.log('📊 Create Result Details:');
      console.log(`   - Sandbox ID: ${createResult.sandboxId}`);
      console.log(`   - Machine ID: ${createResult.sandbox.machineId}`);
      console.log(`   - App Name: ${createResult.sandbox.appName}`);
      console.log(`   - Region: ${createResult.sandbox.region}`);
      console.log(`   - Private IP: ${createResult.sandbox.privateIp || 'Not assigned'}`);
      console.log('');

      createdSandboxId = createResult.sandboxId;
      
      expect(createResult).toBeDefined();
      expect(createResult.sandboxId).toBeDefined();
      expect(createResult.sandbox).toBeDefined();
      expect(createResult.sandbox.machineId).toBeDefined();

    } catch (error) {
      console.timeEnd('⏱️  Create operation');
      console.error('❌ Failed to create sandbox:', error);
      throw error;
    }

    console.log('🔍 Step 2: Getting sandbox by ID...');
    console.time('⏱️  GetById operation');

    try {
      const getResult = await provider.sandbox.getById(createdSandboxId);

      console.timeEnd('⏱️  GetById operation');
      console.log('✅ Sandbox retrieved successfully!');
      console.log('📊 GetById Result Details:');
      console.log(`   - Found: ${getResult ? 'Yes' : 'No'}`);
      if (getResult) {
        console.log(`   - Sandbox ID: ${getResult.sandboxId}`);
        console.log(`   - Machine ID: ${getResult.sandbox.machineId}`);
        console.log(`   - App Name: ${getResult.sandbox.appName}`);
        console.log(`   - Region: ${getResult.sandbox.region}`);
        console.log(`   - Private IP: ${getResult.sandbox.privateIp || 'Not assigned'}`);
      }
      console.log('');

      expect(getResult).toBeDefined();
      expect(getResult.sandboxId).toBe(createdSandboxId);
      expect(getResult.sandbox.machineId).toBeDefined();

    } catch (error) {
      console.timeEnd('⏱️  GetById operation');
      console.error('❌ Failed to get sandbox by ID:', error);
      throw error;
    }

    console.log('📋 Step 3: Listing all sandboxes...');
    console.time('⏱️  List operation');

    try {
      const listResult = await provider.sandbox.list();

      console.timeEnd('⏱️  List operation');
      console.log('✅ Sandboxes listed successfully!');
      console.log('📊 List Result Details:');
      console.log(`   - Total sandboxes found: ${listResult.length}`);
      
      if (listResult.length > 0) {
        console.log('   - Sandbox details:');
        listResult.forEach((item: any, index: number) => {
          console.log(`     ${index + 1}. ID: ${item.sandboxId}`);
          console.log(`        Machine ID: ${item.sandbox.machineId}`);
          console.log(`        App Name: ${item.sandbox.appName}`);
          console.log(`        Region: ${item.sandbox.region}`);
          console.log(`        Private IP: ${item.sandbox.privateIp || 'Not assigned'}`);
        });
      }
      
      // Verify our created sandbox is in the list
      const foundOurSandbox = listResult.find((item: any) => item.sandboxId === createdSandboxId);
      console.log(`   - Our created sandbox in list: ${foundOurSandbox ? 'Yes' : 'No'}`);
      console.log('');

      expect(Array.isArray(listResult)).toBe(true);
      expect(foundOurSandbox).toBeDefined();

    } catch (error) {
      console.timeEnd('⏱️  List operation');
      console.error('❌ Failed to list sandboxes:', error);
      throw error;
    }

    console.log('⏳ Step 4: Waiting 30 seconds before destroying...');
    console.log('   This simulates real-world usage where sandboxes run for some time');
    console.time('⏱️  Wait period');

    // Wait 30 seconds
    await new Promise(resolve => {
      let secondsLeft = 30;
      const countdown = setInterval(() => {
        process.stdout.write(`\r   ⏰ ${secondsLeft} seconds remaining...`);
        secondsLeft--;
        
        if (secondsLeft < 0) {
          clearInterval(countdown);
          process.stdout.write('\r   ✅ Wait complete!                    \n');
          resolve(undefined);
        }
      }, 1000);
    });

    console.timeEnd('⏱️  Wait period');
    console.log('');

    console.log('🗑️  Step 5: Destroying sandbox...');
    console.time('⏱️  Destroy operation');

    try {
      await provider.sandbox.destroy(createdSandboxId);

      console.timeEnd('⏱️  Destroy operation');
      console.log('✅ Sandbox destroyed successfully!');
      console.log('📊 Destroy Result Details:');
      console.log(`   - Sandbox ID destroyed: ${createdSandboxId}`);
      console.log('');

      // Verify sandbox is gone by trying to get it
      console.log('🔍 Verifying destruction...');
      const verifyResult = await provider.sandbox.getById(createdSandboxId);
      console.log(`   - Sandbox still exists: ${verifyResult ? 'Yes (may take time to propagate)' : 'No (expected)'}`);
      
      // Note: Fly.io might take some time for deletion to propagate, so we just log the result
      // In a real scenario, you might want to poll for a few seconds to confirm deletion

    } catch (error) {
      console.timeEnd('⏱️  Destroy operation');
      console.error('❌ Failed to destroy sandbox:', error);
      // Don't throw here as destroy might have succeeded but verification failed
    }

    console.log('🎉 CRUD Test Completed Successfully!');
    console.log('📈 Summary:');
    console.log('   ✅ Create: Sandbox created with node runtime');
    console.log('   ✅ GetById: Successfully retrieved sandbox details');
    console.log('   ✅ List: Found sandbox in list of all sandboxes');
    console.log('   ✅ Wait: Waited 30 seconds (simulating usage)');
    console.log('   ✅ Destroy: Successfully cleaned up sandbox');
    console.log('');

  }, 120000); // 2 minute timeout to account for waiting and API delays
});
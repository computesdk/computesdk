import { describe, it, expect } from 'vitest';
import { config } from 'dotenv';
import path from 'path';
import { awsLambda } from '../index';

// Load environment variables from root .env file
config({ path: path.resolve(__dirname, '../../../../.env') });

describe('AWS Lambda Provider - Detailed CRUD Test', () => {
  // Use a longer timeout for real AWS API calls
  const testTimeout = 120000; // 2 minutes

  it('should complete full CRUD workflow with detailed logging', async () => {
    console.log('\n========================================');
    console.log('🚀 Starting AWS Lambda CRUD Test');
    console.log('========================================\n');

    // Initialize provider
    console.log('📋 Step 1: Initializing AWS Lambda Provider');
    console.log('   - Region:', process.env.AWS_REGION || 'us-east-2 (default)');
    console.log('   - Role ARN:', process.env.AWS_LAMBDA_ROLE_ARN ? 'Set ✅' : 'Missing ❌');
    console.log('   - Access Key ID:', process.env.AWS_ACCESS_KEY_ID ? `${process.env.AWS_ACCESS_KEY_ID.substring(0, 8)}...` : 'Missing ❌');
    
    const provider = awsLambda({
      roleArn: process.env.AWS_LAMBDA_ROLE_ARN,
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    });

    console.log('   ✅ Provider initialized successfully\n');

    let createdSandboxId: string | undefined;

    try {
      // CREATE
      console.log('========================================');
      console.log('📦 Step 2: Creating Lambda Function');
      console.log('========================================');
      console.log('   - Generating unique function name...');
      console.log('   - Creating ZIP file with handler code...');
      console.log('   - ZIP file structure:');
      console.log('     • Local file header for index.js');
      console.log('     • Handler code (Node.js)');
      console.log('     • Central directory header');
      console.log('     • End of central directory record');
      
      const createStartTime = Date.now();
      const created = await provider.sandbox.create({ runtime: 'node' });
      const createDuration = Date.now() - createStartTime;
      
      createdSandboxId = created.sandboxId;
      const lambdaInstance = created.getInstance();
      
      console.log('   ✅ Lambda function created successfully!');
      console.log('   📊 Creation Details:');
      console.log('      - Sandbox ID:', created.sandboxId);
      console.log('      - Function Name:', lambdaInstance.functionName);
      console.log('      - Function ARN:', lambdaInstance.functionArn);
      console.log('      - Runtime:', lambdaInstance.runtime);
      console.log('      - Duration:', `${createDuration}ms`);
      console.log('      - Provider:', created.provider);
      
      expect(created).toBeDefined();
      expect(created.sandboxId).toBeDefined();
      expect(typeof created.sandboxId).toBe('string');
      expect(lambdaInstance.functionName).toBe(createdSandboxId);
      expect(lambdaInstance.functionArn).toContain('arn:aws:lambda');
      expect(lambdaInstance.runtime).toBe('nodejs20.x');

      // GET BY ID
      console.log('\n========================================');
      console.log('🔍 Step 3: Getting Function by ID');
      console.log('========================================');
      console.log('   - Looking up function:', createdSandboxId);
      
      const getStartTime = Date.now();
      const retrieved = await provider.sandbox.getById(createdSandboxId);
      const getDuration = Date.now() - getStartTime;
      
      const retrievedInstance = retrieved?.getInstance();
      
      console.log('   ✅ Function retrieved successfully!');
      console.log('   📊 Retrieved Details:');
      console.log('      - Sandbox ID:', retrieved?.sandboxId);
      console.log('      - Function Name:', retrievedInstance?.functionName);
      console.log('      - Function ARN:', retrievedInstance?.functionArn);
      console.log('      - Runtime:', retrievedInstance?.runtime);
      console.log('      - Duration:', `${getDuration}ms`);
      console.log('      - Match:', retrieved?.sandboxId === createdSandboxId ? '✅ MATCH' : '❌ MISMATCH');
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.sandboxId).toBe(createdSandboxId);
      expect(retrievedInstance?.functionArn).toBe(lambdaInstance.functionArn);

      // LIST
      console.log('\n========================================');
      console.log('📋 Step 4: Listing All Lambda Functions');
      console.log('========================================');
      console.log('   - Fetching all functions in region...');
      
      const listStartTime = Date.now();
      const allFunctions = await provider.sandbox.list();
      const listDuration = Date.now() - listStartTime;
      
      console.log('   ✅ Functions listed successfully!');
      console.log('   📊 List Details:');
      console.log('      - Total Functions:', allFunctions.length);
      console.log('      - Duration:', `${listDuration}ms`);
      
      // Find our function in the list
      const ourFunction = allFunctions.find(f => f.sandboxId === createdSandboxId);
      
      if (ourFunction) {
        console.log('      - Our Function Found: ✅');
        console.log('      - Position in List:', allFunctions.findIndex(f => f.sandboxId === createdSandboxId) + 1);
      } else {
        console.log('      - Our Function Found: ❌ NOT FOUND');
      }
      
      // Log first 5 functions for context
      console.log('   📝 Sample Functions (first 5):');
      allFunctions.slice(0, 5).forEach((func, index) => {
        const funcInstance = func.getInstance();
        const isOurs = func.sandboxId === createdSandboxId ? ' ⭐ (OURS)' : '';
        console.log(`      ${index + 1}. ${func.sandboxId}${isOurs}`);
        console.log(`         Runtime: ${funcInstance.runtime}`);
      });
      
      expect(Array.isArray(allFunctions)).toBe(true);
      expect(allFunctions.length).toBeGreaterThan(0);
      expect(ourFunction).toBeDefined();
      expect(ourFunction?.sandboxId).toBe(createdSandboxId);

      // WAIT
      console.log('\n========================================');
      console.log('⏳ Step 5: Waiting 30 Seconds');
      console.log('========================================');
      console.log('   - Purpose: Allow function to stabilize before cleanup');
      console.log('   - Duration: 30 seconds');
      
      for (let i = 30; i > 0; i -= 5) {
        console.log(`   ⏰ ${i} seconds remaining...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      console.log('   ✅ Wait completed!');

      // DESTROY
      console.log('\n========================================');
      console.log('🗑️  Step 6: Destroying Lambda Function');
      console.log('========================================');
      console.log('   - Deleting function:', createdSandboxId);
      
      const destroyStartTime = Date.now();
      await provider.sandbox.destroy(createdSandboxId);
      const destroyDuration = Date.now() - destroyStartTime;
      
      console.log('   ✅ Function destroyed successfully!');
      console.log('   📊 Destruction Details:');
      console.log('      - Function Name:', createdSandboxId);
      console.log('      - Duration:', `${destroyDuration}ms`);
      console.log('      - Status: Deleted');

      // VERIFY DELETION
      console.log('\n========================================');
      console.log('✔️  Step 7: Verifying Deletion');
      console.log('========================================');
      console.log('   - Attempting to retrieve deleted function...');
      
      const verifyStartTime = Date.now();
      const shouldBeNull = await provider.sandbox.getById(createdSandboxId);
      const verifyDuration = Date.now() - verifyStartTime;
      
      if (shouldBeNull === null) {
        console.log('   ✅ Function confirmed deleted!');
        console.log('   📊 Verification Details:');
        console.log('      - Result: null (as expected)');
        console.log('      - Duration:', `${verifyDuration}ms`);
      } else {
        console.log('   ⚠️  Function still exists (may take time to propagate)');
        console.log('   📊 Verification Details:');
        console.log('      - Result:', shouldBeNull);
        console.log('      - Duration:', `${verifyDuration}ms`);
      }
      
      expect(shouldBeNull).toBeNull();

      // SUMMARY
      console.log('\n========================================');
      console.log('✅ CRUD Test Completed Successfully!');
      console.log('========================================');
      console.log('📊 Test Summary:');
      console.log('   - Create Duration:', `${createDuration}ms`);
      console.log('   - GetById Duration:', `${getDuration}ms`);
      console.log('   - List Duration:', `${listDuration}ms`);
      console.log('   - Destroy Duration:', `${destroyDuration}ms`);
      console.log('   - Verify Duration:', `${verifyDuration}ms`);
      console.log('   - Total Functions Found:', allFunctions.length);
      console.log('   - Function Name:', createdSandboxId);
      console.log('========================================\n');

    } catch (error) {
      // ERROR HANDLING
      console.log('\n========================================');
      console.log('❌ Test Failed with Error');
      console.log('========================================');
      console.log('   Error Type:', error instanceof Error ? error.constructor.name : typeof error);
      console.log('   Error Message:', error instanceof Error ? error.message : String(error));
      
      if (error instanceof Error && error.stack) {
        console.log('   Stack Trace:');
        console.log(error.stack.split('\n').map(line => `      ${line}`).join('\n'));
      }
      
      // Attempt emergency cleanup
      if (createdSandboxId) {
        console.log('\n   🧹 Attempting emergency cleanup...');
        try {
          await provider.sandbox.destroy(createdSandboxId);
          console.log('   ✅ Emergency cleanup successful');
        } catch (cleanupError) {
          console.log('   ⚠️  Emergency cleanup failed:', cleanupError);
        }
      }
      
      console.log('========================================\n');
      throw error;
    }
  }, testTimeout);
});

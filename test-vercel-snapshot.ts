import { vercel } from './packages/vercel/src/index';
import { Sandbox as VercelSandbox } from '@vercel/sandbox';

const SNAPSHOT_ID = 'snap_S5B3xfvypqlTYCMgmC3MK7gQ3cq0';

const VERCEL_CONFIG = {
  token: 'ZPUfPOkMtrp66jfVLjh6Yn95',
  teamId: 'team_iRqku0jW89d8N1XcznOi4GmS',
  projectId: 'prj_SFxawqu8ieeh1OjUMb8qmd2EJtgt',
};

async function testDirectVercel() {
  console.log('=== Testing DIRECT @vercel/sandbox ===');
  try {
    console.log('Creating sandbox with params:', JSON.stringify({
      source: { type: 'snapshot', snapshotId: SNAPSHOT_ID },
      token: '***',
      teamId: VERCEL_CONFIG.teamId,
      projectId: VERCEL_CONFIG.projectId
    }, null, 2));
    
    const sandbox = await VercelSandbox.create({
      source: {
        type: 'snapshot',
        snapshotId: SNAPSHOT_ID
      },
      token: VERCEL_CONFIG.token,
      teamId: VERCEL_CONFIG.teamId,
      projectId: VERCEL_CONFIG.projectId,
    });
    console.log('✅ Direct Vercel SDK: Sandbox created:', sandbox.sandboxId);
    
    // Test if bun exists
    const result = await sandbox.runCommand('which', ['bun']);
    const stdout = await result.stdout();
    console.log('Direct Vercel SDK - which bun:', stdout.trim() || '(empty)');
    
    await sandbox.stop();
    return true;
  } catch (error: any) {
    console.log('❌ Direct Vercel SDK failed:', error.message);
    return false;
  }
}

async function testComputeSDKVercel() {
  console.log('\n=== Testing @computesdk/vercel ===');
  try {
    const provider = vercel(VERCEL_CONFIG);
    
    console.log('Creating sandbox with snapshotId:', SNAPSHOT_ID);
    const result = await provider.sandbox.create({ snapshotId: SNAPSHOT_ID });
    const sandbox = result.sandbox;
    console.log('✅ ComputeSDK Vercel: Sandbox created:', result.sandboxId);
    
    // Test if bun exists
    const cmdResult = await sandbox.runCommand('which', ['bun']);
    const stdout = await cmdResult.stdout();
    console.log('ComputeSDK Vercel - which bun:', stdout.trim() || '(empty)');
    
    await sandbox.stop();
    return true;
  } catch (error: any) {
    console.log('❌ ComputeSDK Vercel failed:', error.message);
    console.log('Stack:', error.stack);
    return false;
  }
}

async function main() {
  const directResult = await testDirectVercel();
  const computeSDKResult = await testComputeSDKVercel();
  
  console.log('\n=== RESULTS ===');
  console.log('Direct @vercel/sandbox:', directResult ? '✅ PASS' : '❌ FAIL');
  console.log('@computesdk/vercel:    ', computeSDKResult ? '✅ PASS' : '❌ FAIL');
}

main().catch(console.error);

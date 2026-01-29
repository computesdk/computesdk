import { vercel } from './packages/vercel/src/index';
import { Sandbox as VercelSandbox } from '@vercel/sandbox';

const SNAPSHOT_ID = 'snap_S5B3xfvypqlTYCMgmC3MK7gQ3cq0';

const VERCEL_CONFIG = {
  token: 'ZPUfPOkMtrp66jfVLjh6Yn95',
  teamId: 'team_iRqku0jW89d8N1XcznOi4GmS',
  projectId: 'prj_SFxawqu8ieeh1OjUMb8qmd2EJtgt',
};

async function testConfigPrecedence() {
  console.log('=== Testing Config Precedence Over OIDC Env Var ===');
  console.log('VERCEL_OIDC_TOKEN env var is set to: "fake-oidc-token-that-should-be-ignored"');
  console.log('Config credentials are provided explicitly\n');
  
  try {
    const provider = vercel(VERCEL_CONFIG);
    
    console.log('Creating sandbox with snapshotId:', SNAPSHOT_ID);
    const result = await provider.sandbox.create({ snapshotId: SNAPSHOT_ID });
    const sandbox = result.sandbox;
    console.log('✅ Sandbox created:', result.sandboxId);
    
    // Test if bun exists (proves snapshot was used)
    const cmdResult = await sandbox.runCommand('which', ['bun']);
    const stdout = await cmdResult.stdout();
    console.log('which bun:', stdout.trim() || '(empty)');
    
    if (stdout.includes('/bun')) {
      console.log('\n✅ SUCCESS: Config credentials were used (not OIDC)');
      console.log('   Snapshot was properly restored with bun installed');
    } else {
      console.log('\n❌ FAIL: Snapshot was NOT restored (bun missing)');
      console.log('   OIDC token may have been used instead of config');
    }
    
    await sandbox.stop();
    return true;
  } catch (error: any) {
    console.log('❌ FAILED:', error.message);
    if (error.message.includes('OIDC')) {
      console.log('\n   This error suggests OIDC was incorrectly used instead of config credentials');
    }
    return false;
  }
}

testConfigPrecedence().catch(console.error);

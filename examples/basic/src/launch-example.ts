/**
 * Launch Video Demo - Simple ComputeSDK Example
 * 
 * Shows the core workflow: provider → sandbox → writeFile → runCommand → cleanup
 */

import { e2b } from '@computesdk/e2b';
// import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';
import { compute } from 'computesdk';
import { config } from 'dotenv';
config();

async function main() {
  // Configure provider - swap any of these!

  // compute.setConfig({ 
  //   provider: vercel({ 
  //     token: process.env.VERCEL_TOKEN,
  //     teamId: process.env.VERCEL_TEAM_ID,
  //     projectId: process.env.VERCEL_PROJECT_ID,
  //   }) 
  // });

  compute.setConfig({ provider: daytona({ apiKey: process.env.DAYTONA_API_KEY }) });

  // compute.setConfig({ provider: e2b({ apiKey: process.env.E2B_API_KEY }) });

  // and more!!

  // Create sandbox
  const sandbox = await compute.sandbox.create();
  console.log('✅ Sandbox created:', sandbox.sandboxId);

  // Write a simple Python script
  await sandbox.filesystem.writeFile('/tmp/demo.py', `print("🚀 ComputeSDK Launch Demo")`);
  console.log('✅ File written: /tmp/demo.py');

  // Run the script
  const result = await sandbox.runCommand('python', ['/tmp/demo.py']);
  console.log('✅ Script executed:');
  console.log(result.stdout);

  // Cleanup
  await sandbox.kill();
  console.log('✅ Sandbox cleaned up');
}

main().catch(console.error);

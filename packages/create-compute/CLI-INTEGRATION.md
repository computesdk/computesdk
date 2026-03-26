/**
 * How to add workspace commands to PR #344's CLI
 * 
 * This shows the minimal changes needed to index.ts to support workspaces
 */

// In packages/create-compute/src/index.ts, add these commands:

import {
  workspaceCreate,
  workspaceAttach,
  workspaceList,
  workspaceDestroy,
} from './workspace-cli.js';

// Add to program setup:

program
  .command('workspace')
  .description('Create or attach to a workspace')
  .argument('[repo]', 'Repository (owner/repo format)')
  .option('-b, --branch <branch>', 'Branch name', 'main')
  .option('-p, --provider <provider>', 'Compute provider')
  .action(async (repo, options) => {
    console.log();
    p.intro(pc.cyan(`create-compute v${packageJson.version}`));
    
    await ensureAuth();
    
    if (!repo) {
      // Interactive mode - list and select
      const state = loadState(); // From workspace-cli
      
      if (Object.keys(state.workspaces).length === 0) {
        p.log.info('No workspaces found.');
        p.log.info('Usage: compute workspace owner/repo --branch main');
        process.exit(0);
      }
      
      // Show picker
      const choices = Object.values(state.workspaces).map(ws => ({
        value: ws.id,
        label: `${ws.id} (${ws.provider})`,
      }));
      
      const selected = await p.select({
        message: 'Select workspace',
        options: [
          ...choices,
          { value: '__new__', label: pc.gray('+ Create new workspace') },
        ],
      });
      
      if (p.isCancel(selected)) {
        process.exit(0);
      }
      
      if (selected === '__new__') {
        p.log.info('Usage: compute workspace owner/repo --branch main');
        process.exit(0);
      }
      
      await workspaceAttach(selected as string);
      return;
    }
    
    // Create or attach to specific workspace
    const workspace = await workspaceCreate({
      repo,
      branch: options.branch,
      provider: options.provider,
    });
    
    // Attach to it
    await workspaceAttach(workspace.id);
  });

program
  .command('workspaces')
  .alias('ws')
  .description('List all workspaces')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`create-compute v${packageJson.version}`));
    await workspaceList();
  });

program
  .command('workspace-destroy')
  .alias('ws-rm')
  .description('Destroy a workspace')
  .argument('[id]', 'Workspace ID (repo:branch)')
  .action(async (id) => {
    console.log();
    p.intro(pc.cyan(`create-compute v${packageJson.version}`));
    await workspaceDestroy(id);
  });

/*

MINIMAL CHANGES SUMMARY:

1. Add bootstrap.sh (the script I wrote)
2. Add workspace-cli.ts (the workspace management logic)  
3. Wire up 3 commands in index.ts (workspace, workspaces, workspace-destroy)

That's it! 

The workspace commands reuse:
- ✅ PR #344's sandbox.create() / sandbox.destroy()
- ✅ PR #344's auth flow
- ✅ PR #344's provider selection
- ✅ PR #344's PTY mode for attachment

What we add:
- Local state file (~/.computesdk/workspaces.json)
- Bootstrap script that runs inside sandbox
- Workspace ID mapping (repo:branch → sandbox)

Total new code: ~500 lines
- 250 for bootstrap.sh
- 200 for workspace-cli.ts  
- 50 for command wiring

*/

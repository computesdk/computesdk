#!/usr/bin/env node
/**
 * Minimal workspace CLI using existing PR #344 infrastructure
 * 
 * This is a thin wrapper around sandbox.create() + bootstrap script
 * that adds the workspace concept without SDK changes.
 */

import { compute } from 'computesdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { startREPL } from './repl.js';

const WORKSPACE_STATE_FILE = path.join(os.homedir(), '.computesdk', 'workspaces.json');

interface Workspace {
  id: string;  // repo:branch
  repo: string;
  branch: string;
  sandboxId: string;
  provider: string;
  worktreePath: string;
  createdAt: string;
  lastUsed: string;
}

interface WorkspaceState {
  workspaces: Record<string, Workspace>;
}

// Export Workspace interface
export type { Workspace, WorkspaceState };

// Shell escape helper to prevent command injection
function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9._\-/:=@]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// Load workspace state
export function loadState(): WorkspaceState {
  try {
    if (!fs.existsSync(WORKSPACE_STATE_FILE)) {
      return { workspaces: {} };
    }
    const raw = fs.readFileSync(WORKSPACE_STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { workspaces: {} };
  }
}

// Export alias for index.ts
export const loadWorkspaceState = loadState;

// Save workspace state
export function saveState(state: WorkspaceState): void {
  const dir = path.dirname(WORKSPACE_STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(WORKSPACE_STATE_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

// Get workspace ID from repo and branch
function getWorkspaceId(repo: string, branch: string): string {
  return `${repo}:${branch}`;
}

// Create or attach to workspace
export async function workspaceCreate(options: {
  repo: string;
  branch: string;
  provider?: string;
}): Promise<Workspace> {
  const { repo, branch, provider } = options;
  const id = getWorkspaceId(repo, branch);
  const state = loadState();
  
  // Check if workspace already exists
  if (state.workspaces[id]) {
    const existing = state.workspaces[id];
    
    // Verify sandbox still exists
    try {
      const sandbox = await compute.sandbox.getById(existing.sandboxId);
      if (!sandbox) {
        throw new Error('Sandbox not found');
      }
      
      // Just update last used
      existing.lastUsed = new Date().toISOString();
      saveState(state);
      
      p.log.info(`Attaching to existing workspace: ${pc.cyan(id)}`);
      return existing;
    } catch {
      // Sandbox is gone, remove from state and recreate
      delete state.workspaces[id];
    }
  }
  
  // Create new sandbox
  p.log.info('Creating sandbox...');
  const spinner = p.spinner();
  spinner.start('Provisioning via ComputeSDK...');
  
  let sandbox;
  try {
    // TODO: Configure compute with provider
    sandbox = await compute.sandbox.create();
    spinner.stop(`Sandbox ready: ${pc.cyan(sandbox.sandboxId)}`);
  } catch (error) {
    spinner.stop(pc.red('Failed to create sandbox'));
    throw error;
  }
  
  // Run bootstrap script
  spinner.start('Bootstrapping workspace (installing gh CLI, cloning repo)...');
  
  // Read bootstrap script
  const bootstrapScript = fs.readFileSync(
    new URL('./bootstrap.sh', import.meta.url),
    'utf-8'
  );
  
  // Write and execute bootstrap script in sandbox
  try {
    // Write script to sandbox
    await sandbox.filesystem.writeFile('/tmp/bootstrap.sh', bootstrapScript);
    
    // Make executable and run
    await sandbox.runCommand('chmod +x /tmp/bootstrap.sh');
    
    // Run bootstrap with repo and branch
    // Note: This is interactive for device flow auth
    spinner.stop('Running bootstrap (you may need to authenticate with GitHub)...');
    
    const result = await sandbox.runCommand(
      `/tmp/bootstrap.sh ${shellEscape(repo)} ${shellEscape(branch)}`,
      { timeout: 300000 } // 5 min timeout for auth
    );
    
    // Parse bootstrap output for paths
    const output = result.stdout || '';
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    let worktreePath = `/workspaces/${path.basename(repo)}-${branch}`;
    
    if (jsonMatch) {
      try {
        const bootstrapInfo = JSON.parse(jsonMatch[0]);
        worktreePath = bootstrapInfo.worktree_path || worktreePath;
      } catch {
        // Use default path
      }
    }
    
    // Create workspace record
    const workspace: Workspace = {
      id,
      repo,
      branch,
      sandboxId: sandbox.sandboxId,
      provider: provider || 'e2b', // TODO: Get actual provider
      worktreePath,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
    
    state.workspaces[id] = workspace;
    saveState(state);
    
    p.log.success(`Workspace ready: ${pc.cyan(id)}`);
    p.log.info(`Sandbox: ${pc.dim(sandbox.sandboxId)}`);
    p.log.info(`Worktree: ${pc.dim(worktreePath)}`);
    
    return workspace;
    
  } catch (error) {
    spinner.stop(pc.red('Bootstrap failed'));
    // Cleanup sandbox on failure
    try {
      await sandbox.destroy();
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// Attach to existing workspace
export async function workspaceAttach(id: string): Promise<void> {
  const state = loadState();
  const workspace = state.workspaces[id];
  
  if (!workspace) {
    p.log.error(`Workspace not found: ${id}`);
    p.log.info(`Run: compute workspace create --repo owner/repo --branch ${id.split(':')[1] || 'main'}`);
    process.exit(1);
  }
  
  // Get sandbox
  const sandbox = await compute.sandbox.getById(workspace.sandboxId);
  if (!sandbox) {
    p.log.error(`Sandbox no longer exists: ${workspace.sandboxId}`);
    delete state.workspaces[id];
    saveState(state);
    process.exit(1);
  }
  
  // Update last used
  workspace.lastUsed = new Date().toISOString();
  saveState(state);
  
  p.log.info(`Attaching to workspace: ${pc.cyan(id)}`);
  p.log.info(`Worktree: ${pc.dim(workspace.worktreePath)}`);
  console.log(pc.gray(`Tip: commands run at sandbox root; use { cwd: "${workspace.worktreePath}" } on runCommand to scope them.`));

  try {
    await startREPL(sandbox, workspace.provider);
  } catch (error) {
    p.log.error(`Failed to attach: ${(error as Error).message}`);
    process.exit(1);
  }
}

// List all sandboxes (via workspaces)
export async function sandboxList(): Promise<void> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  
  if (workspaces.length === 0) {
    p.log.info('No sandboxes found.');
    p.log.info('Create one with: compute owner/repo --branch main');
    return;
  }
  
  console.log();
  console.log(pc.bold('Sandboxes'));
  console.log();
  
  for (const ws of workspaces) {
    const age = Math.round((Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24));
    const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
    const status = age > 7 ? pc.red('stale') : age > 1 ? pc.yellow('idle') : pc.green('active');
    
    console.log(`  ${status} ${pc.cyan(ws.sandboxId)}`);
    console.log(`    Workspace: ${pc.dim(ws.id)}`);
    console.log(`    Provider: ${ws.provider}`);
    console.log(`    Last active: ${pc.gray(ageStr)}`);
    console.log();
  }
  
  console.log(pc.gray('Tip: Use "compute workspaces" to see full workspace details'));
}

// List all workspaces
export async function workspaceList(): Promise<void> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  
  if (workspaces.length === 0) {
    p.log.info('No workspaces found.');
    p.log.info('Create one with: compute owner/repo --branch main');
    return;
  }
  
  console.log();
  console.log(pc.bold('Workspaces'));
  console.log();
  
  for (const ws of workspaces) {
    const age = Math.round((Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24));
    const ageStr = age === 0 ? 'today' : `${age}d ago`;
    
    console.log(`  ${pc.cyan(ws.id)}`);
    console.log(`    Sandbox: ${pc.dim(ws.sandboxId)} (${ws.provider})`);
    console.log(`    Path: ${pc.dim(ws.worktreePath)}`);
    console.log(`    Last used: ${pc.gray(ageStr)}`);
    console.log();
  }
}

// Save a simple sandbox (without workspace/repo info)
export async function saveSandbox(sandbox: {
  id: string;
  sandboxId: string;
  provider: string;
  createdAt: string;
  lastUsed: string;
}): Promise<void> {
  const state = loadState();
  
  // Store as a minimal "workspace" with just sandbox info
  state.workspaces[sandbox.id] = {
    id: sandbox.id,
    repo: '(no repo)',
    branch: '(raw sandbox)',
    sandboxId: sandbox.sandboxId,
    provider: sandbox.provider,
    worktreePath: '/',
    createdAt: sandbox.createdAt,
    lastUsed: sandbox.lastUsed,
  };
  
  saveState(state);
}

// Destroy workspace
export async function workspaceDestroy(id?: string): Promise<void> {
  const state = loadState();
  
  if (id) {
    // Destroy specific workspace
    const workspace = state.workspaces[id];
    if (!workspace) {
      p.log.error(`Workspace not found: ${id}`);
      return;
    }
    
    p.log.info(`Destroying workspace: ${pc.cyan(id)}`);
    
    try {
      await compute.sandbox.destroy(workspace.sandboxId);
      delete state.workspaces[id];
      saveState(state);
      p.log.success('Workspace destroyed');
    } catch (error) {
      p.log.error(`Failed to destroy: ${(error as Error).message}`);
    }
  } else {
    // Interactive selection
    const choices = Object.values(state.workspaces).map(ws => ({
      value: ws.id,
      label: `${ws.id} (${ws.provider}, last used ${Math.round((Date.now() - new Date(ws.lastUsed).getTime()) / (1000 * 60 * 60 * 24))}d ago)`
    }));
    
    if (choices.length === 0) {
      p.log.info('No workspaces to destroy');
      return;
    }
    
    const selected = await p.select({
      message: 'Select workspace to destroy',
      options: choices,
    });
    
    if (p.isCancel(selected)) {
      return;
    }
    
    await workspaceDestroy(selected as string);
  }
}

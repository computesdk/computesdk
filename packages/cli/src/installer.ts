/**
 * Installer logic for create-compute onboarding wizard
 * 
 * This runs when user executes: npx create-compute
 * It installs @computesdk/cli globally and runs interactive setup
 */

import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface InstallOptions {
  skipInstall?: boolean;
  skipAuth?: boolean;
  skipDemo?: boolean;
}

/**
 * Check if @computesdk/cli is installed globally
 */
function isCliInstalled(): boolean {
  try {
    execSync('compute --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the installed CLI version
 */
function getCliVersion(): string | null {
  try {
    const output = execSync('compute --version', { encoding: 'utf-8', stdio: 'pipe' });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * Install @computesdk/cli globally
 */
async function installCli(): Promise<boolean> {
  const spinner = p.spinner();
  spinner.start('Installing @computesdk/cli globally...');
  
  try {
    // Detect package manager
    const packageManager = detectPackageManager();
    
    const installCmd = packageManager === 'yarn' 
      ? 'yarn global add @computesdk/cli'
      : packageManager === 'pnpm'
        ? 'pnpm add -g @computesdk/cli'
        : 'npm install -g @computesdk/cli';
    
    execSync(installCmd, { stdio: 'pipe' });
    spinner.stop('Installed @computesdk/cli');
    return true;
  } catch (error) {
    spinner.stop(pc.red('Failed to install'));
    p.log.error((error as Error).message);
    p.log.info('You can install manually: npm install -g @computesdk/cli');
    return false;
  }
}

/**
 * Detect which package manager to use
 */
function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' {
  try {
    execSync('pnpm --version', { stdio: 'pipe' });
    return 'pnpm';
  } catch {
    try {
      execSync('yarn --version', { stdio: 'pipe' });
      return 'yarn';
    } catch {
      return 'npm';
    }
  }
}

/**
 * Run the interactive onboarding wizard
 */
export async function runInstaller(options: InstallOptions = {}): Promise<void> {
  console.log();
  p.intro(pc.cyan('Welcome to ComputeSDK!'));
  
  // Step 1: Check/install CLI
  if (!options.skipInstall) {
    if (isCliInstalled()) {
      const version = getCliVersion();
      p.log.success(`@computesdk/cli is installed (${version})`);
    } else {
      const shouldInstall = await p.confirm({
        message: 'Install @computesdk/cli globally?',
        initialValue: true,
      });
      
      if (p.isCancel(shouldInstall) || !shouldInstall) {
        p.log.info('You can install later with: npm install -g @computesdk/cli');
        p.outro('Setup incomplete');
        return;
      }
      
      const installed = await installCli();
      if (!installed) {
        p.outro(pc.red('Setup failed'));
        return;
      }
    }
  }
  
  // Step 2: Authenticate with ComputeSDK
  if (!options.skipAuth) {
    p.log.step('Authentication');
    
    // Check if already authenticated
    const hasAuth = await checkExistingAuth();
    
    if (hasAuth) {
      p.log.success('Already authenticated with ComputeSDK');
    } else {
      p.log.info('Please authenticate with ComputeSDK to continue');
      
      const authMethod = await p.select({
        message: 'How would you like to authenticate?',
        options: [
          { value: 'browser', label: 'Browser (recommended)' },
          { value: 'token', label: 'API Token' },
        ],
      });
      
      if (p.isCancel(authMethod)) {
        p.cancel('Setup cancelled');
        return;
      }
      
      if (authMethod === 'browser') {
        // Import and run the auth flow from PR #344
        const { resolveApiKey } = await import('./auth.js');
        try {
          const apiKey = await resolveApiKey({ forceLogin: true });
          p.log.success(`Authenticated! Key: ${pc.dim(apiKey.slice(0, 10))}...`);
        } catch (error) {
          p.log.error('Authentication failed');
          p.outro(pc.red('Setup incomplete'));
          return;
        }
      } else {
        const token = await p.text({
          message: 'Enter your ComputeSDK API key',
          placeholder: 'computesdk_live_...',
          validate: (value) => {
            if (!value || !value.startsWith('computesdk_')) {
              return 'Please enter a valid ComputeSDK API key';
            }
          },
        });
        
        if (p.isCancel(token)) {
          p.cancel('Setup cancelled');
          return;
        }
        
        // Store the token and set env for current process
        const { storeCredentials } = await import('./auth.js');
        storeCredentials(token as string);
        process.env.COMPUTESDK_API_KEY = token as string;
        p.log.success('API key stored');
      }
    }
  }
  
  // Step 3: Configure default provider
  p.log.step('Provider Configuration');
  
  const { detectAvailableProviders, getProviderStatus } = await import('./providers.js');
  const available = detectAvailableProviders();
  
  if (available.length === 0) {
    p.log.warn('No cloud providers configured');
    p.log.info('To use ComputeSDK, you need to set up a provider:');
    console.log();
    console.log(pc.gray('  E2B:     export E2B_API_KEY=your_key'));
    console.log(pc.gray('  Modal:   export MODAL_TOKEN_ID=... MODAL_TOKEN_SECRET=...'));
    console.log(pc.gray('  Railway: export RAILWAY_API_KEY=...'));
    console.log();
    
    const continueAnyway = await p.confirm({
      message: 'Continue without a provider? (You can set one up later)',
      initialValue: false,
    });
    
    if (p.isCancel(continueAnyway) || !continueAnyway) {
      p.outro('Setup incomplete');
      return;
    }
  } else if (available.length === 1) {
    p.log.success(`Using provider: ${pc.cyan(available[0])}`);
  } else {
    const providerStatus = getProviderStatus();
    const providerOptions = providerStatus
      .filter(s => s.ready)
      .map(s => ({ value: s.name, label: s.name }));
    
    const provider = await p.select({
      message: 'Select your default provider',
      options: providerOptions,
    });
    
    if (p.isCancel(provider)) {
      p.cancel('Setup cancelled');
      return;
    }
    
    // Store default provider preference
    const configDir = path.join(os.homedir(), '.computesdk');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const config = loadConfig();
    config.defaultProvider = provider as string;
    saveConfig(config);
    
    p.log.success(`Default provider set: ${pc.cyan(provider as string)}`);
  }
  
  // Step 4: Create demo workspace (optional)
  if (!options.skipDemo && available.length > 0) {
    const createDemo = await p.confirm({
      message: 'Create your first workspace?',
      initialValue: true,
    });
    
    if (!p.isCancel(createDemo) && createDemo) {
      const repo = await p.text({
        message: 'Which repository?',
        placeholder: 'owner/repo',
        validate: (value) => {
          if (!value || !value.includes('/')) {
            return 'Please enter a repository in owner/repo format';
          }
        },
      });
      
      if (!p.isCancel(repo)) {
        const branch = await p.text({
          message: 'Which branch?',
          placeholder: 'main',
          initialValue: 'main',
        });
        
        if (!p.isCancel(branch)) {
          p.log.info('Creating workspace...');
          
          // Ensure auth is configured
          const { resolveApiKey } = await import('./auth.js');
          const apiKey = await resolveApiKey();
          if (!apiKey) {
            p.log.error('ComputeSDK API key is required. Please run setup first.');
            return;
          }
          
          // Use the workspace CLI we created
          const { workspaceCreate } = await import('./workspace-cli.js');
          
          try {
            const workspace = await workspaceCreate({
              repo: repo as string,
              branch: (branch as string) || 'main',
            });
            
            p.log.success(`Workspace created: ${pc.cyan(workspace.id)}`);
            
            const attachNow = await p.confirm({
              message: 'Attach to your new workspace now?',
              initialValue: true,
            });
            
            if (!p.isCancel(attachNow) && attachNow) {
              const { workspaceAttach } = await import('./workspace-cli.js');
              await workspaceAttach(workspace.id);
              return; // Attach handles the exit
            }
          } catch (error) {
            p.log.error(`Failed to create workspace: ${(error as Error).message}`);
          }
        }
      }
    }
  }
  
  // Success message
  console.log();
  console.log(pc.bold('╔════════════════════════════════════════╗'));
  console.log(pc.bold('║     You\'re all set! 🎉                  ║'));
  console.log(pc.bold('╠════════════════════════════════════════╣'));
  console.log(pc.bold('║                                        ║'));
  console.log(pc.bold('║  Quick start:                          ║'));
  console.log(pc.bold('║    ' + pc.cyan('compute workspace owner/repo') + '        ║'));
  console.log(pc.bold('║    ' + pc.cyan('compute workspaces') + '                    ║'));
  console.log(pc.bold('║    ' + pc.cyan('compute --help') + '                        ║'));
  console.log(pc.bold('║                                        ║'));
  console.log(pc.bold('║  Happy coding! 🚀                      ║'));
  console.log(pc.bold('╚════════════════════════════════════════╝'));
  console.log();
  
  p.outro(pc.green('Setup complete!'));
}

/**
 * Check if user has existing ComputeSDK auth
 */
async function checkExistingAuth(): Promise<boolean> {
  try {
    const { loadStoredCredentials } = await import('./auth.js');
    return loadStoredCredentials() !== null || !!process.env.COMPUTESDK_API_KEY;
  } catch {
    return !!process.env.COMPUTESDK_API_KEY;
  }
}

/**
 * Load user config
 */
function loadConfig(): Record<string, unknown> {
  const configPath = path.join(os.homedir(), '.computesdk', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return {};
}

/**
 * Save user config
 */
function saveConfig(config: Record<string, unknown>): void {
  const configDir = path.join(os.homedir(), '.computesdk');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Run if executed directly
if (import.meta.url === 'file://' + process.argv[1]) {
  runInstaller().catch((error) => {
    console.error(pc.red('Error: ' + error.message));
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * create-compute
 *
 * Installer for @computesdk/cli.
 * Run once to set up the ComputeSDK CLI tool.
 *
 * Usage:
 *   npm create compute                    # Interactive setup + install CLI
 *   npm create compute -- owner/repo      # Install CLI + create workspace
 */

import { execSync, spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';

const CLI_PACKAGE = '@computesdk/cli';

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
 * Install @computesdk/cli globally
 */
async function installCli(): Promise<boolean> {
  const spinner = p.spinner();
  spinner.start('Installing ' + CLI_PACKAGE + ' globally...');
  
  try {
    const packageManager = detectPackageManager();
    
    const installCmd = packageManager === 'yarn' 
      ? 'yarn global add ' + CLI_PACKAGE
      : packageManager === 'pnpm'
        ? 'pnpm add -g ' + CLI_PACKAGE
        : 'npm install -g ' + CLI_PACKAGE;
    
    execSync(installCmd, { stdio: 'pipe' });
    spinner.stop('Installed ' + CLI_PACKAGE);
    return true;
  } catch (error) {
    spinner.stop(pc.red('Failed to install'));
    p.log.error((error as Error).message);
    p.log.info('You can install manually: npm install -g ' + CLI_PACKAGE);
    return false;
  }
}

/**
 * Run the installer
 */
async function main(): Promise<void> {
  console.log();
  p.intro(pc.cyan('create-compute'));
  
  // Check if CLI is installed
  if (isCliInstalled()) {
    const version = getCliVersion();
    p.log.success(CLI_PACKAGE + ' is already installed (' + version + ')');
  } else {
    p.log.step('Setup');
    p.log.info('This will install the ComputeSDK CLI globally.');
    
    const shouldInstall = await p.confirm({
      message: 'Install ' + CLI_PACKAGE + '?',
      initialValue: true,
    });
    
    if (p.isCancel(shouldInstall) || !shouldInstall) {
      p.log.info('You can install later with: npm install -g ' + CLI_PACKAGE);
      p.outro('Setup incomplete');
      process.exit(0);
    }
    
    const installed = await installCli();
    if (!installed) {
      p.outro(pc.red('Setup failed'));
      process.exit(1);
    }
    
    console.log();
    console.log(pc.bold('╔════════════════════════════════════════╗'));
    console.log(pc.bold('║     CLI Installed! 🎉                  ║'));
    console.log(pc.bold('╠════════════════════════════════════════╣'));
    console.log(pc.bold('║                                        ║'));
    console.log(pc.bold('║  Quick start:                          ║'));
    console.log(pc.bold('║    compute owner/repo                  ║'));
    console.log(pc.bold('║    compute workspace                   ║'));
    console.log(pc.bold('║    compute --help                      ║'));
    console.log(pc.bold('║                                        ║'));
    console.log(pc.bold('╚════════════════════════════════════════╝'));
    console.log();
  }
  
  // Pass through any arguments to the compute CLI
  const args = process.argv.slice(2);
  
  // If no args provided, run compute interactively (which shows workspace picker)
  if (args.length === 0) {
    p.log.info('Starting interactive mode...');
  }
  
  // Forward to compute CLI (with or without args)
  const displayArgs = args.length > 0 ? args.join(' ') : '(interactive)';
  p.log.info('Running: compute ' + displayArgs);
  
  try {
    const result = spawn('compute', args, {
      stdio: 'inherit',
      shell: true,
    });
    
    result.on('close', (code) => {
      process.exit(code || 0);
    });
  } catch (error) {
    p.log.error('Failed to run compute: ' + (error as Error).message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(pc.red('Error: ' + error.message));
  process.exit(1);
});

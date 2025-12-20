/**
 * Output formatting utilities
 * 
 * Provides consistent, colorful output for workbench
 */

import type { WorkbenchState } from './state.js';
import { formatUptime } from './state.js';

/**
 * ANSI color codes (simple, no dependencies for now)
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Color helpers
 */
export const c = {
  bold: (text: string) => `${colors.bright}${text}${colors.reset}`,
  dim: (text: string) => `${colors.dim}${text}${colors.reset}`,
  cyan: (text: string) => `${colors.cyan}${text}${colors.reset}`,
  green: (text: string) => `${colors.green}${text}${colors.reset}`,
  yellow: (text: string) => `${colors.yellow}${text}${colors.reset}`,
  red: (text: string) => `${colors.red}${text}${colors.reset}`,
  blue: (text: string) => `${colors.blue}${text}${colors.reset}`,
  magenta: (text: string) => `${colors.magenta}${text}${colors.reset}`,
};

/**
 * Display welcome banner
 */
export function showWelcome(availableProviders: string[], currentProvider: string | null, useDirectMode: boolean) {
  console.log(c.bold(c.cyan('\n╔═══════════════════════════════════════════════════════╗')));
  console.log(c.bold(c.cyan('║   ComputeSDK Workbench                               ║')));
  console.log(c.bold(c.cyan('╚═══════════════════════════════════════════════════════╝\n')));
  
  if (availableProviders.length > 0) {
    // Filter out 'gateway' from the list since it's not a real backend provider
    const backendProviders = availableProviders.filter(p => p !== 'gateway');
    console.log(`Providers available: ${backendProviders.join(', ')}`);
    
    if (currentProvider) {
      if (useDirectMode) {
        console.log(`Current provider: ${c.green(currentProvider)} (🔗 direct mode)\n`);
      } else {
        // Gateway mode - show which backend will be used
        const backendProvider = currentProvider === 'gateway' 
          ? (backendProviders[0] || 'auto')
          : currentProvider;
        console.log(`Current provider: ${c.green(backendProvider)} (🌐 via gateway)\n`);
      }
    } else {
      console.log(`\n${c.dim('Tip: Use "provider <name>" to select a provider')}\n`);
    }
  } else {
    console.log(c.yellow('⚠️  No providers detected.\n'));
    console.log('To get started:');
    console.log('  1. Copy .env.example to .env');
    console.log('  2. Add your provider credentials');
    console.log('  3. Restart workbench\n');
    console.log(c.dim('Type "env" to see required environment variables\n'));
  }
  
  console.log(c.dim('Type "help" for available commands\n'));
}



/**
 * Display sandbox info
 */
export function showInfo(state: WorkbenchState) {
  if (!state.currentSandbox) {
    console.log(c.yellow('\nNo active sandbox\n'));
    return;
  }
  
  console.log('\n' + c.bold('Current Sandbox:'));
  console.log(`  Provider: ${c.green(state.currentProvider || 'unknown')}`);
  console.log(`  Created: ${state.sandboxCreatedAt?.toLocaleString() || 'unknown'}`);
  console.log(`  Uptime: ${formatUptime(state)}`);
  console.log('');
}

/**
 * Simple spinner class (no external deps)
 */
export class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame = 0;
  private text: string;
  
  constructor(text: string) {
    this.text = text;
  }
  
  start(): this {
    process.stdout.write('\x1B[?25l'); // Hide cursor
    this.interval = setInterval(() => {
      const frame = this.frames[this.currentFrame];
      process.stdout.write(`\r${c.cyan(frame)} ${this.text}`);
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
    return this;
  }
  
  succeed(text?: string): void {
    this.stop();
    console.log(`${c.green('✅')} ${text || this.text}`);
  }
  
  fail(text?: string): void {
    this.stop();
    console.log(`${c.red('❌')} ${text || this.text}`);
  }
  
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1B[K'); // Clear line
    process.stdout.write('\x1B[?25h'); // Show cursor
  }
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) {
    return `${ms}ms`;
  }
  return `${seconds.toFixed(1)}s`;
}

/**
 * Log command being run
 */
export function logCommand(command: string[]) {
  console.log(c.dim(`Running: ${command.join(' ')}`));
}

/**
 * Log success
 */
export function logSuccess(message: string, duration?: number) {
  const durationStr = duration ? ` (${formatDuration(duration)})` : '';
  console.log(c.green(`✅ ${message}${durationStr}`));
}

/**
 * Display help text
 */
export function showHelp() {
  console.log(`
${c.bold('ComputeSDK Workbench Commands')}

${c.bold('Provider Management:')}
  ${c.cyan('provider <name>')}              Switch to provider via gateway (default)
                                ${c.dim('Example: provider e2b')}
  ${c.cyan('provider direct <name>')}       Connect directly to provider
                                ${c.dim('Example: provider direct e2b')}
  ${c.cyan('providers')}                    List all providers with status
  ${c.cyan('mode <gateway|direct>')}        Toggle default mode for next sandbox

${c.bold('Provider Modes:')}
  ${c.bold('Gateway (default)')}: Routes through ComputeSDK API, zero-config
    • Requires: COMPUTESDK_API_KEY + provider credentials
    • Usage: ${c.cyan('provider e2b')}
  
  ${c.bold('Direct')}: Connects directly to provider, requires packages
    • Requires: Provider package installed + credentials
    • Usage: ${c.cyan('provider direct e2b')}

${c.bold('Sandbox Management:')}
  ${c.cyan('restart')}                      Restart current sandbox
  ${c.cyan('destroy')}                      Destroy current sandbox
  ${c.cyan('info')}                         Show sandbox info (provider, uptime)

${c.bold('Environment:')}
  ${c.cyan('env')}                          Show environment/credentials status
  ${c.cyan('verbose')}                      Toggle verbose output mode

${c.bold('Help:')}
  ${c.cyan('help')}                         Show this help message
  ${c.cyan('exit')} or ${c.cyan('.exit')}             Exit workbench

${c.bold('Running Commands:')}
  Type any @computesdk/cmd function and it will run automatically:
  
  ${c.dim('Package Managers:')}
    ${c.cyan('npm.install("express")')}
    ${c.cyan('pip.install("requests")')}
  
  ${c.dim('Git:')}
    ${c.cyan('git.clone("https://github.com/user/repo")')}
    ${c.cyan('git.status()')}
  
  ${c.dim('Filesystem:')}
    ${c.cyan('ls("/home")')}
    ${c.cyan('cat("/etc/hosts")')}
    ${c.cyan('rm.rf("/tmp")')}          ${c.dim('// Force remove')}
    ${c.cyan('rm.auto("/path")')}       ${c.dim('// Smart remove')}
  
  ${c.dim('Compute CLI:')}
    ${c.cyan('compute.isSetup()')}      ${c.dim('// Check if daemon is running')}
    ${c.cyan('compute.setup()')}        ${c.dim('// Install + start daemon')}
    ${c.cyan('compute.install()')}      ${c.dim('// Install compute CLI')}
    ${c.cyan('compute.start()')}        ${c.dim('// Start daemon')}
    ${c.cyan('compute.health()')}       ${c.dim('// Check daemon health')}

${c.bold('Shell Commands:')}
  Use ${c.cyan('$')} prefix to run any shell command directly:
    ${c.cyan('$ls -la /app')}
    ${c.cyan('$npm install express')}
    ${c.cyan('$git status')}
    ${c.cyan('$compute --help')}

${c.bold('Background Execution:')}
  ${c.cyan('sh("npm start", { background: true })')}
  ${c.cyan('sh("python -m http.server 8000", { background: true })')}

${c.dim('Press Tab for autocomplete on all commands!')}
`);
}

/**
 * Log error
 */
export function logError(message: string) {
  console.log(c.red(`❌ ${message}`));
}

/**
 * Log warning
 */
export function logWarning(message: string) {
  console.log(c.yellow(`⚠️  ${message}`));
}

/**
 * Log info
 */
export function logInfo(message: string) {
  console.log(c.blue(`ℹ️  ${message}`));
}

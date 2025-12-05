/**
 * Dependency management for compute daemon installation
 *
 * Handles detection and installation of required system dependencies
 * (curl and bash) needed to run the compute daemon install script.
 */

import type { Sandbox } from '../types';

/**
 * Check if a command is available in the sandbox
 */
async function isCommandAvailable(sandbox: Sandbox, command: string): Promise<boolean> {
  const result = await sandbox.runCommand('sh', ['-c', `command -v ${command}`]);
  return result.exitCode === 0;
}

/**
 * Detect package manager available in the sandbox
 */
export async function detectPackageManager(sandbox: Sandbox): Promise<'apk' | 'apt' | null> {
  // Try Alpine's apk first (most common in minimal containers)
  if (await isCommandAvailable(sandbox, 'apk')) {
    return 'apk';
  }

  // Fall back to Debian/Ubuntu apt
  if (await isCommandAvailable(sandbox, 'apt-get')) {
    return 'apt';
  }

  return null;
}

/**
 * Install required dependencies (curl and bash) if missing
 */
export async function ensureDependencies(sandbox: Sandbox): Promise<void> {
  const hasCurl = await isCommandAvailable(sandbox, 'curl');
  const hasBash = await isCommandAvailable(sandbox, 'bash');

  // If both are available, nothing to do
  if (hasCurl && hasBash) {
    return;
  }

  const packageManager = await detectPackageManager(sandbox);

  if (!packageManager) {
    throw new Error(
      `Missing required tools (curl: ${hasCurl}, bash: ${hasBash}), but no supported package manager found.\n` +
      `Supported package managers: apk (Alpine), apt-get (Debian/Ubuntu).\n` +
      `Please use a sandbox image that includes curl and bash, or install them manually first.`
    );
  }

  let installResult;

  if (packageManager === 'apk') {
    // Alpine Linux
    installResult = await sandbox.runCommand('sh', ['-c', 'apk add --no-cache curl bash 2>&1']);
  } else {
    // Debian/Ubuntu
    installResult = await sandbox.runCommand('sh', ['-c', 'apt-get update -qq && apt-get install -qq -y curl bash 2>&1']);
  }

  if (installResult.exitCode !== 0) {
    throw new Error(
      `Failed to install curl and bash using ${packageManager}.\n` +
      `Install output: ${installResult.stderr || installResult.stdout}\n` +
      `Please install curl and bash manually or use a different sandbox image.`
    );
  }
}

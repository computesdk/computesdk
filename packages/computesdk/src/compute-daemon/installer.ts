/**
 * Compute daemon installation orchestration
 *
 * Handles downloading and installing the compute daemon binary
 * inside sandboxes, including dependency management and verification.
 */

import type { Sandbox } from '../types';
import type { AuthorizationResponse } from '../auth/license';
import { ensureDependencies } from './dependencies';

/**
 * Check if compute daemon is already installed in the sandbox
 */
async function isComputeInstalled(sandbox: Sandbox): Promise<boolean> {
  const result = await sandbox.runCommand('sh', ['-c', 'test -f /usr/local/bin/compute && echo "exists" || echo "missing"']);
  return result.stdout?.trim() === 'exists';
}

/**
 * Download the compute install script
 */
async function downloadInstallScript(sandbox: Sandbox): Promise<void> {
  const downloadResult = await sandbox.runCommand('sh', ['-c', 'curl -fsSL https://computesdk.com/install.sh -o /tmp/compute-install.sh 2>&1']);

  if (downloadResult.exitCode !== 0) {
    const errorOutput = downloadResult.stderr || downloadResult.stdout || 'unknown error';
    throw new Error(
      `Failed to download install script from https://computesdk.com/install.sh: ${errorOutput}`
    );
  }
}

/**
 * Run the compute install script
 */
async function runInstallScript(sandbox: Sandbox, accessToken?: string): Promise<void> {
  const installCommand = accessToken
    ? `bash /tmp/compute-install.sh --non-interactive --access-token "${accessToken}" --location /usr/local/bin`
    : `bash /tmp/compute-install.sh --non-interactive --location /usr/local/bin`;

  const installResult = await sandbox.runCommand('bash', ['-c', installCommand]);

  if (installResult.exitCode !== 0) {
    const errorOutput = installResult.stderr || installResult.stdout || 'unknown error';
    throw new Error(`Failed to install compute daemon: ${errorOutput}`);
  }
}

/**
 * Install and start compute daemon inside a sandbox
 *
 * This is the main installation orchestrator that:
 * 1. Checks if compute is already installed
 * 2. Ensures curl and bash are available (installs if needed)
 * 3. Downloads the install script
 * 4. Runs the install script with proper credentials
 * 5. Verifies the installation succeeded
 */
export async function installComputeDaemon(
  sandbox: Sandbox,
  accessToken?: string
): Promise<void> {
  // Check if compute is already installed
  if (await isComputeInstalled(sandbox)) {
    return;
  }

  // Ensure required dependencies are available
  await ensureDependencies(sandbox);

  // Download install script
  await downloadInstallScript(sandbox);

  // Run install script with credentials
  await runInstallScript(sandbox, accessToken);

  // Verify installation succeeded
  if (!await isComputeInstalled(sandbox)) {
    throw new Error('Compute binary not found at /usr/local/bin/compute after installation');
  }
}

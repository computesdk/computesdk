/**
 * Docker Provider - Factory-based Implementation using Testcontainers
 *
 * Full-featured provider with filesystem support using Docker containers.
 * Uses testcontainers-node for reliable Docker container management.
 */

import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { createProvider, createBackgroundCommand } from 'computesdk';

import type {
  ExecutionResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions
} from 'computesdk';

/**
 * Docker-specific configuration options
 */
export interface DockerConfig {
  /** Docker image to use - if not provided, will select based on runtime */
  image?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Docker container wrapper that tracks container metadata
 */
interface DockerSandbox {
  container: StartedTestContainer;
  runtime: Runtime;
  createdAt: Date;
}

/**
 * Active containers registry for tracking and cleanup
 */
const activeContainers = new Map<string, DockerSandbox>();

/**
 * Get default Docker image for a runtime
 */
function getDefaultImage(runtime: Runtime): string {
  switch (runtime) {
    case 'python':
      return 'python:3.11-alpine';
    case 'node':
    default:
      return 'node:20-alpine';
  }
}

/**
 * Execute a command in a Docker container and return the result
 */
async function executeInContainer(
  container: StartedTestContainer,
  command: string,
  args: string[] = [],
  sandboxId: string
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Build full command
    const fullCommand = args.length > 0 ? [command, ...args] : [command];

    // Execute command in container
    const result = await container.exec(fullCommand);

    return {
      stdout: result.output || '',
      stderr: result.exitCode !== 0 ? (result.output || '') : '',
      exitCode: result.exitCode,
      executionTime: Date.now() - startTime,
      sandboxId,
      provider: 'docker'
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127, // Command not found
      executionTime: Date.now() - startTime,
      sandboxId,
      provider: 'docker'
    };
  }
}

/**
 * Create a Docker provider instance using the factory pattern
 */
export const docker = createProvider<DockerSandbox, DockerConfig>({
  name: 'docker',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: DockerConfig, options?: CreateSandboxOptions) => {
        const runtime = options?.runtime || config.runtime || 'node';
        const image = config.image || getDefaultImage(runtime);

        try {
          // Create container with testcontainers
          const container = await new GenericContainer(image)
            .withCommand(['tail', '-f', '/dev/null']) // Keep container running
            .withStartupTimeout(120000) // 2 minute timeout for image pull
            .start();

          const sandboxId = container.getId();

          const dockerSandbox: DockerSandbox = {
            container,
            runtime,
            createdAt: new Date()
          };

          // Track container for cleanup
          activeContainers.set(sandboxId, dockerSandbox);

          return {
            sandbox: dockerSandbox,
            sandboxId
          };
        } catch (error) {
          throw new Error(
            `Failed to create Docker sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: DockerConfig, sandboxId: string) => {
        // Check if we have this container in our registry
        const dockerSandbox = activeContainers.get(sandboxId);

        if (!dockerSandbox) {
          return null;
        }

        return {
          sandbox: dockerSandbox,
          sandboxId
        };
      },

      list: async (config: DockerConfig) => {
        // Return all active containers from our registry
        return Array.from(activeContainers.entries()).map(([sandboxId, sandbox]) => ({
          sandbox,
          sandboxId
        }));
      },

      destroy: async (config: DockerConfig, sandboxId: string) => {
        const dockerSandbox = activeContainers.get(sandboxId);

        if (dockerSandbox) {
          try {
            // Wrap stop in a timeout promise to prevent hanging
            await Promise.race([
              dockerSandbox.container.stop({ timeout: 1000 }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Stop timeout')), 3000)
              )
            ]);
          } catch (error) {
            // If stop times out or fails, try to force remove via Docker CLI
            try {
              // Get container ID and force remove
              const containerId = dockerSandbox.container.getId();
              // Import exec from child_process
              const { exec } = await import('child_process');
              await new Promise<void>((resolve) => {
                exec(`docker rm -f ${containerId}`, () => resolve());
              });
            } catch {
              // Even force remove failed, but we'll continue
            }
          } finally {
            // Always remove from tracking
            activeContainers.delete(sandboxId);
          }
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: DockerSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();
        const sandboxId = sandbox.container.getId();
        const effectiveRuntime = runtime || sandbox.runtime;

        try {
          // Auto-detect runtime if not specified
          const detectedRuntime = effectiveRuntime || (
            // Strong Python indicators
            code.includes('print(') ||
            code.includes('import ') ||
            code.includes('def ') ||
            code.includes('sys.') ||
            code.includes('json.') ||
            code.includes('__') ||
            code.includes('f"') ||
            code.includes("f'") ||
            code.includes('raise ')
              ? 'python'
              : 'node'
          );

          // Use base64 encoding for reliable code transfer
          const encoded = Buffer.from(code).toString('base64');

          let result;
          if (detectedRuntime === 'python') {
            result = await sandbox.container.exec([
              'sh', '-c',
              `echo "${encoded}" | base64 -d | python3`
            ]);
          } else {
            result = await sandbox.container.exec([
              'sh', '-c',
              `echo "${encoded}" | base64 -d | node`
            ]);
          }

          // Check for syntax errors
          const output = result.output || '';
          if (result.exitCode !== 0 && output) {
            if (output.includes('SyntaxError') ||
                output.includes('invalid syntax') ||
                output.includes('Unexpected token') ||
                output.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${output.trim()}`);
            }
          }

          return {
            stdout: result.exitCode === 0 ? output : '',
            stderr: result.exitCode !== 0 ? output : '',
            exitCode: result.exitCode,
            executionTime: Date.now() - startTime,
            sandboxId,
            provider: 'docker'
          };
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }

          // For other runtime errors, return result
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            executionTime: Date.now() - startTime,
            sandboxId,
            provider: 'docker'
          };
        }
      },

      runCommand: async (sandbox: DockerSandbox, command: string, args: string[] = [], options?: RunCommandOptions): Promise<ExecutionResult> => {
        const startTime = Date.now();
        const sandboxId = sandbox.container.getId();

        try {
          // Handle background command execution
          const { command: finalCommand, args: finalArgs, isBackground } = createBackgroundCommand(command, args, options);

          const result = await sandbox.container.exec(
            finalArgs.length > 0 ? [finalCommand, ...finalArgs] : [finalCommand]
          );

          return {
            stdout: result.output || '',
            stderr: result.exitCode !== 0 ? (result.output || '') : '',
            exitCode: result.exitCode,
            executionTime: Date.now() - startTime,
            sandboxId,
            provider: 'docker',
            isBackground,
            ...(isBackground && { pid: -1 })
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            executionTime: Date.now() - startTime,
            sandboxId,
            provider: 'docker'
          };
        }
      },

      getInfo: async (sandbox: DockerSandbox): Promise<SandboxInfo> => {
        const sandboxId = sandbox.container.getId();

        return {
          id: sandboxId,
          provider: 'docker',
          runtime: sandbox.runtime,
          status: 'running',
          createdAt: sandbox.createdAt,
          timeout: 300000,
          metadata: {
            containerId: sandboxId
          }
        };
      },

      getUrl: async (sandbox: DockerSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const host = sandbox.container.getHost();
          const mappedPort = sandbox.container.getMappedPort(options.port);
          const protocol = options.protocol || 'http';
          return `${protocol}://${host}:${mappedPort}`;
        } catch (error) {
          throw new Error(
            `Failed to get Docker container URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Optional filesystem methods
      filesystem: {
        readFile: async (sandbox: DockerSandbox, path: string): Promise<string> => {
          const result = await sandbox.container.exec(['cat', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to read file: ${path}`);
          }
          return result.output || '';
        },

        writeFile: async (sandbox: DockerSandbox, path: string, content: string): Promise<void> => {
          // Use base64 encoding to safely handle special characters
          const encoded = Buffer.from(content).toString('base64');
          const result = await sandbox.container.exec([
            'sh', '-c',
            `echo "${encoded}" | base64 -d > ${path}`
          ]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to write file: ${path}`);
          }
        },

        mkdir: async (sandbox: DockerSandbox, path: string): Promise<void> => {
          const result = await sandbox.container.exec(['mkdir', '-p', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory: ${path}`);
          }
        },

        readdir: async (sandbox: DockerSandbox, path: string): Promise<FileEntry[]> => {
          // Use ls -la with parseable format
          const result = await sandbox.container.exec([
            'sh', '-c',
            `ls -la "${path}" | tail -n +2` // Skip the "total" line
          ]);

          if (result.exitCode !== 0) {
            throw new Error(`Failed to read directory: ${path}`);
          }

          const output = result.output || '';
          const lines = output.split('\n').filter(line => line.trim());

          return lines.map(line => {
            const parts = line.split(/\s+/);
            const isDirectory = parts[0]?.startsWith('d') || false;
            const name = parts[parts.length - 1] || '';
            const size = parseInt(parts[4] || '0', 10);

            return {
              name,
              path: `${path}/${name}`.replace(/\/+/g, '/'),
              isDirectory,
              size,
              lastModified: new Date()
            };
          }).filter(entry => entry.name !== '.' && entry.name !== '..');
        },

        exists: async (sandbox: DockerSandbox, path: string): Promise<boolean> => {
          const result = await sandbox.container.exec(['test', '-e', path]);
          return result.exitCode === 0;
        },

        remove: async (sandbox: DockerSandbox, path: string): Promise<void> => {
          const result = await sandbox.container.exec(['rm', '-rf', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove: ${path}`);
          }
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: DockerSandbox): DockerSandbox => {
        return sandbox;
      }
    }
  }
});

/**
 * Export types for use in other packages
 */
export type { DockerSandbox };

/**
 * HopX Provider - Factory-based Implementation
 * 
 * Full-featured provider with native filesystem support using the factory pattern.
 * HopX provides isolated cloud sandboxes (lightweight VMs) with full Linux environments.
 * 
 * Features:
 * - Native filesystem API via sandbox.files.*
 * - Code execution in Python, JavaScript, Bash
 * - Shell command execution
 * - Preview URLs for accessing sandbox services
 */

import { Sandbox as HopxSandbox, Template as HopxTemplate, createTemplate as createHopxTemplate } from '@hopx-ai/sdk';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  CreateTemplateOptions,
} from 'computesdk';

/**
 * HopX-specific configuration options
 */
export interface HopxConfig {
  /** HopX API key - if not provided, will fallback to HOPX_API_KEY environment variable */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Template name for sandbox creation (e.g., 'code-interpreter') */
  template?: string;
  /** Base API URL for custom/staging environments */
  baseURL?: string;
}

/**
 * Create a HopX provider instance using the factory pattern
 * 
 * HopX provides isolated cloud sandboxes with:
 * - Full root access to the VM
 * - Pre-installed language runtimes (Python, Node.js, etc.)
 * - Persistent filesystem during session
 * - Automatic cleanup after timeout
 */
export const hopx = defineProvider<HopxSandbox, HopxConfig>({
  name: 'hopx',
  methods: {
    sandbox: {
      /**
       * Create a new HopX sandbox
       * 
       * Uses Sandbox.create() from @hopx-ai/sdk to provision a new sandbox.
       * Default template is 'code-interpreter' if not specified.
       */
      create: async (config: HopxConfig, options?: CreateSandboxOptions) => {
        // Validate API key - fail fast with helpful error message
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing HopX API key. Provide 'apiKey' in config or set HOPX_API_KEY environment variable. Get your API key from https://hopx.ai/dashboard`
          );
        }

        // Convert timeout from milliseconds to seconds (HopX uses seconds)
        // options.timeout takes precedence over config.timeout
        const timeout = options?.timeout ?? config.timeout;
        const timeoutSeconds = timeout ? Math.ceil(timeout / 1000) : undefined;

        try {
          let sandbox: HopxSandbox;
          let sandboxId: string;

          // Destructure known ComputeSDK fields, collect the rest for passthrough
          const {
            timeout: _timeout,
            envs,
            name,
            metadata: _metadata,
            templateId,
            snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            ...providerOptions
          } = options || {};

            // Create new HopX sandbox using Sandbox.create()
            const createOptions: any = {
              apiKey,
              baseURL: config.baseURL,
              timeoutSeconds,
              ...providerOptions, // Spread provider-specific options
            };

            // Handle template specification (templateId/snapshotId takes precedence)
            if (templateId || snapshotId) {
              createOptions.templateId = templateId || snapshotId;
            } else {
              createOptions.template = config.template || 'code-interpreter';
            }

            // Remap envs to envVars
            if (envs) {
              createOptions.envVars = envs;
            }

            // Pass sandbox name
            if (name) {
              createOptions.name = name;
            }

          sandbox = await HopxSandbox.create(createOptions);
          sandboxId = sandbox.sandboxId;

          return {
            sandbox,
            sandboxId
          };
        } catch (error) {
          // Provide helpful error messages for common issues
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key') || error.message.includes('401')) {
              throw new Error(
                `HopX authentication failed. Please check your HOPX_API_KEY environment variable. Get your API key from https://hopx.ai/dashboard`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `HopX quota exceeded. Please check your usage at https://hopx.ai/dashboard`
              );
            }
          }
          throw new Error(
            `Failed to create HopX sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      /**
       * Connect to an existing HopX sandbox by ID
       * 
       * Uses Sandbox.connect() to reconnect to a running sandbox.
       * Returns null if sandbox doesn't exist or can't be accessed.
       */
      getById: async (config: HopxConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';

        if (!apiKey) {
          return null;
        }

        try {
          // Connect to existing sandbox using Sandbox.connect()
          const sandbox = await HopxSandbox.connect(sandboxId, apiKey, config.baseURL);

          return {
            sandbox,
            sandboxId
          };
        } catch (error) {
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      /**
       * List all active HopX sandboxes
       * 
       * Uses Sandbox.list() to get all sandboxes for the account.
       */
      list: async (config: HopxConfig) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';

        if (!apiKey) {
          return [];
        }

        try {
          // List sandboxes using Sandbox.list()
          const sandboxes = await HopxSandbox.list({
            apiKey,
            baseURL: config.baseURL,
          });

          return sandboxes.map((sandbox: HopxSandbox) => ({
            sandbox,
            sandboxId: sandbox.sandboxId
          }));
        } catch (error) {
          // Return empty array if listing fails
          return [];
        }
      },

      /**
       * Destroy a HopX sandbox
       * 
       * Uses sandbox.kill() to terminate and clean up the sandbox.
       */
      destroy: async (config: HopxConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';

        if (!apiKey) {
          return;
        }

        try {
          // Connect to sandbox and kill it
          const sandbox = await HopxSandbox.connect(sandboxId, apiKey, config.baseURL);
          await sandbox.kill();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      /**
       * Execute a shell command in the sandbox
       * 
       * Uses sandbox.commands.run() to execute shell commands.
       * Arguments are properly quoted to handle special characters.
       */
      runCommand: async (sandbox: HopxSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          // Build command with options
          let fullCommand = command;
          
          // Handle environment variables
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          
          // Handle working directory
          if (options?.cwd) {
            fullCommand = `cd "${options.cwd.replace(/"/g, '\\"')}" && ${fullCommand}`;
          }
          
          // Handle background execution
          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }
      
          // Execute command using sandbox.commands.run()
          const result = await sandbox.commands.run(fullCommand, {
            timeout: options?.timeout ? Math.ceil(options.timeout / 1000) : undefined,
          });
      
          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exit_code || 0,  // Note: HopX uses snake_case
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          // Extract result from error if available (some errors include partial results)
          const result = (error as any)?.result;
          if (result) {
            return {
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              exitCode: result.exit_code || 1,
              durationMs: Date.now() - startTime
            };
          }
          
          // Fallback for other errors (command not found, etc.)
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime
          };
        }
      },

      /**
       * Get sandbox information
       * 
       * Uses sandbox.getInfo() to retrieve sandbox metadata.
       */
      getInfo: async (sandbox: HopxSandbox): Promise<SandboxInfo> => {
        try {
          const info = await sandbox.getInfo();

          return {
            id: sandbox.sandboxId,
            provider: 'hopx',
            status: (info.status as 'running' | 'stopped' | 'error') || 'running',
            createdAt: info.createdAt ? new Date(info.createdAt) : new Date(),
            timeout: info.timeoutSeconds ? info.timeoutSeconds * 1000 : 300000,
            metadata: {
              templateName: info.templateName,
              templateId: info.templateId,
              region: info.region,
              publicHost: info.publicHost,
            }
          };
        } catch (error) {
          // Return basic info if getInfo fails
          return {
            id: sandbox.sandboxId,
            provider: 'hopx',
            status: 'running',
            createdAt: new Date(),
            timeout: 300000,
            metadata: {}
          };
        }
      },

      /**
       * Get preview URL for a specific port
       * 
       * Uses sandbox.getPreviewUrl() to get the public URL for accessing
       * services running on a specific port in the sandbox.
       */
      getUrl: async (sandbox: HopxSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          // Use HopX's built-in getPreviewUrl method
          const url = await sandbox.getPreviewUrl(options.port);
          return url;
        } catch (error) {
          throw new Error(
            `Failed to get HopX URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      /**
       * Native filesystem operations using HopX's files API
       * 
       * HopX has full native filesystem support via sandbox.files.*
       * This is Option A from the documentation (native API, not shell-based).
       */
      filesystem: {
        /**
         * Read file contents from sandbox
         */
        readFile: async (sandbox: HopxSandbox, path: string): Promise<string> => {
          return await sandbox.files.read(path);
        },

        /**
         * Write content to a file in the sandbox
         */
        writeFile: async (sandbox: HopxSandbox, path: string, content: string): Promise<void> => {
          await sandbox.files.write(path, content);
        },

        /**
         * Create a directory in the sandbox
         */
        mkdir: async (sandbox: HopxSandbox, path: string): Promise<void> => {
          await sandbox.files.mkdir(path);
        },

        /**
         * List directory contents
         * 
         * Maps HopX's EnhancedFileInfo to ComputeSDK's FileEntry format.
         */
        readdir: async (sandbox: HopxSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(path);

          return entries.map((entry: any) => ({
            name: entry.name,
            type: (entry.isDir || entry.isDirectory) ? 'directory' as const : 'file' as const,
            path: entry.path || `${path}/${entry.name}`.replace(/\/+/g, '/'),
            isDirectory: Boolean(entry.isDir || entry.isDirectory || entry.type === 'directory'),
            size: entry.size || 0,
            lastModified: entry.modTime ? new Date(entry.modTime) : new Date()
          }));
        },

        /**
         * Check if a file or directory exists
         */
        exists: async (sandbox: HopxSandbox, path: string): Promise<boolean> => {
          return await sandbox.files.exists(path);
        },

        /**
         * Remove a file or directory
         */
        remove: async (sandbox: HopxSandbox, path: string): Promise<void> => {
          await sandbox.files.remove(path);
        }
      },

      /**
       * Get the native HopX Sandbox instance for advanced usage
       * 
       * This allows users to access HopX-specific features not exposed
       * through the ComputeSDK interface.
       */
      getInstance: (sandbox: HopxSandbox): HopxSandbox => {
        return sandbox;
      },
    },

    template: {
      create: async (config: HopxConfig, options: CreateTemplateOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';
        if (!apiKey) {
          throw new Error(
            `Missing HopX API key. Provide 'apiKey' in config or set HOPX_API_KEY environment variable.`
          );
        }

        // Capture mode: not supported (no snapshot API)
        if (options.from) {
          throw new Error(
            'HopX does not support capturing templates from running sandboxes. ' +
              'Use build-from-spec mode with baseImage or dockerfile.',
          );
        }

        // Build mode: use Template builder + Template.build()
        try {
          const baseImage = options.baseImage || (options.dockerfile
            ? (options.dockerfile.split('\n').find((l) => l.toUpperCase().startsWith('FROM ')) || '').replace(/^FROM\s+/i, '').trim() || 'ubuntu:22.04'
            : 'ubuntu:22.04');

          const template = createHopxTemplate(baseImage);

          if (options.envs) {
            template.setEnvs(options.envs);
          }

          if (options.startCommand) {
            template.setStartCmd(options.startCommand);
          }

          // If dockerfile is provided, add non-FROM lines as run commands
          if (options.dockerfile) {
            const lines = options.dockerfile.split('\n').filter(
              (l) => l.trim() && !l.toUpperCase().startsWith('FROM '),
            );
            for (const line of lines) {
              if (line.toUpperCase().startsWith('RUN ')) {
                template.runCmd(line.replace(/^RUN\s+/i, ''));
              }
            }
          }

          const buildOptions = {
            name: options.name,
            apiKey,
            ...(config.baseURL ? { baseURL: config.baseURL } : {}),
            ...(options.cpuCount ? { cpu: options.cpuCount } : {}),
            ...(options.memoryMB ? { memory: options.memoryMB } : {}),
          };

          const result = await HopxTemplate.build(template, buildOptions);
          return {
            id: result.templateID,
            provider: 'hopx',
            name: options.name,
            createdAt: new Date(),
            metadata: { ...options.metadata, source: 'build', buildId: result.buildID, duration: result.duration },
          };
        } catch (error) {
          throw new Error(
            `Failed to create HopX template: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      list: async (config: HopxConfig) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';
        if (!apiKey) {
          return [];
        }
        try {
          const templates = await HopxSandbox.listTemplates({
            apiKey,
            ...(config.baseURL ? { baseURL: config.baseURL } : {}),
          });
          return templates.map((info: any) => ({
            id: info.id,
            provider: 'hopx',
            name: info.name || info.displayName || 'unnamed',
            createdAt: info.createdAt ? new Date(info.createdAt) : new Date(),
            metadata: { status: info.status, buildId: info.buildId, isActive: info.isActive, template: info },
          }));
        } catch {
          return [];
        }
      },

      delete: async (config: HopxConfig, templateId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HOPX_API_KEY) || '';
        if (!apiKey) {
          return;
        }
        try {
          await HopxSandbox.deleteTemplate(templateId, {
            apiKey,
            ...(config.baseURL ? { baseURL: config.baseURL } : {}),
          });
        } catch {
          /* already deleted or not found */
        }
      },
    }
  }
});

// Export HopX sandbox type for explicit typing
export type { Sandbox as HopxSandbox } from '@hopx-ai/sdk';

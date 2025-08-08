/**
 * Daytona Provider - Factory-based Implementation
 * 
 * Code execution only provider using the factory pattern.
 * Reduces ~300 lines of boilerplate to ~80 lines of core logic.
 */

import { Daytona, Sandbox as DaytonaSandbox } from '@daytonaio/sdk';
import { createProvider } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions } from 'computesdk';

/**
 * Daytona-specific configuration options
 */
export interface DaytonaConfig {
  /** Daytona API key - if not provided, will fallback to DAYTONA_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Create a Daytona provider instance using the factory pattern
 */
export const daytona = createProvider<DaytonaSandbox, DaytonaConfig>({
  name: 'daytona',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: DaytonaConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.DAYTONA_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing Daytona API key. Provide 'apiKey' in config or set DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
          );
        }

        const runtime = options?.runtime || config.runtime || 'python';
        const timeout = config.timeout || 300000;

        try {
          // Initialize Daytona client
          const daytona = new Daytona({ apiKey: apiKey });

          let session: DaytonaSandbox;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Reconnect to existing Daytona sandbox
            session = await daytona.get(options.sandboxId);
            sandboxId = options.sandboxId;
          } else {
            // Create new Daytona sandbox
            session = await daytona.create({
              language: runtime === 'python' ? 'python' : 'typescript',
            });
            sandboxId = session.id;
          }

          return {
            sandbox: session,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(
                `Daytona authentication failed. Please check your DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Daytona quota exceeded. Please check your usage at https://daytona.io/`
              );
            }
          }
          throw new Error(
            `Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const session = await daytona.get(sandboxId);

          return {
            sandbox: session,
            sandboxId
          };
        } catch (error) {
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const sandboxes = await daytona.list();

          return sandboxes.map((session: any) => ({
            sandbox: session,
            sandboxId: session.id
          }));
        } catch (error) {
          // Return empty array if listing fails
          return [];
        }
      },

      destroy: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          // Note: Daytona SDK expects a Sandbox object, but we only have the ID
          // This is a limitation of the current Daytona SDK design
          // For now, we'll skip the delete operation
          const sandbox = await daytona.get(sandboxId);
          await sandbox.delete();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (sandbox.*)
      runCode: async (session: DaytonaSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Execute code using Daytona's process.codeRun method
          const response = await session.process.codeRun(code);

          return {
            stdout: response.result || '',
            stderr: '', // Daytona doesn't separate stderr in the response
            exitCode: response.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: session.id,
            provider: 'daytona'
          };
        } catch (error) {
          throw new Error(
            `Daytona execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (session: DaytonaSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Construct full command with arguments
          const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

          // Execute command using Daytona's process.executeCommand method
          const response = await session.process.executeCommand(fullCommand);

          return {
            stdout: response.result || '',
            stderr: '', // Daytona doesn't separate stderr in the response
            exitCode: response.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: session.id,
            provider: 'daytona'
          };
        } catch (error) {
          throw new Error(
            `Daytona command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getInfo: async (session: DaytonaSandbox): Promise<SandboxInfo> => {
        return {
          id: session.id,
          provider: 'daytona',
          runtime: 'python', // Daytona default
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            daytonaSandboxId: session.id
          }
        };
      }
    }
  }
});

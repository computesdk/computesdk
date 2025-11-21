/**
 * Railway Provider - Factory-based Implementation
 */

import { createProvider, createBackgroundCommand } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

/**
 * Railway sandbox interface
 */
interface RailwaySandbox {
  serviceId: string;
  projectId: string;
  environmentId: string;
}

export interface RailwayConfig {
  /** Railway API key - if not provided, will fallback to RAILWAY_API_KEY environment variable */
  apiKey?: string;
  /** Railway Project ID */
  projectId?: string;
  /** Railway Environment ID - if not provided, will fallback to RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}

/**
 * Create a Railway provider instance using the factory pattern
 */
export const railway = createProvider<RailwaySandbox, RailwayConfig>({
  name: 'railway',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: RailwayConfig, options?: CreateSandboxOptions) => {
        // Validate API credentials
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.RAILWAY_API_KEY) || '';
        const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.RAILWAY_PROJECT_ID) || '';
        const environmentId = config.environmentId || (typeof process !== 'undefined' && process.env?.RAILWAY_ENVIRONMENT_ID) || '';

        if (!apiKey) {
          throw new Error(
            'Missing Railway API key. Provide apiKey in config or set RAILWAY_API_KEY environment variable.'
          );
        }

        if (!projectId) {
          throw new Error(
            'Missing Railway Project ID. Provide projectId in config or set RAILWAY_PROJECT_ID environment variable.'
          );
        }

        if (!environmentId) {
          throw new Error(
            'Missing Railway Environment ID. Provide environmentId in config or set RAILWAY_ENVIRONMENT_ID environment variable.'
          );
        }

        try {
          const sandboxName = `sandbox-${Date.now()}`;
          const mutation = {
            query: `mutation ServiceCreate($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
            variables: {
              input: {
                projectId,
                environmentId,
                source: {
                  image: options?.runtime === 'node' ? 'node:alpine' : 'python:alpine'
                }
              }
            }
          };

          const response = await fetch('https://backboard.railway.com/graphql/v2', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(mutation)
          });

          if (!response.ok) {
            throw new Error(`Railway API error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          
          if (data.errors) {
            throw new Error(`Railway GraphQL error: ${data.errors.map((e: any) => e.message).join(', ')}`);
          }

          const service = data.data.serviceCreate;
          const railwaySandbox: RailwaySandbox = {
            serviceId: service.id,
            projectId,
            environmentId,
          };

          return {
            sandbox: railwaySandbox,
            sandboxId: service.id
          };
        } catch (error) {
          throw new Error(
            `Failed to create Railway sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (_config: RailwayConfig, _sandboxId: string) => {
        throw new Error('getById method not implemented yet');
      },
      
      list: async (_config: RailwayConfig) => {
        throw new Error('list method not implemented yet');
      },

      destroy: async (config: RailwayConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.RAILWAY_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            'Missing Railway API key. Provide apiKey in config or set RAILWAY_API_KEY environment variable.'
          );
        }

        try {
          const mutation = {
            query: `mutation ServiceDelete($id: String!) { 
              serviceDelete(id: $id) 
            }`,
            variables: {
              id: sandboxId
            }
          };

          const response = await fetch('https://backboard.railway.com/graphql/v2', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(mutation)
          });

          if (!response.ok) {
            throw new Error(`Railway API error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          
          if (data.errors) {
            // Log errors but don't throw for destroy operations
            console.warn(`Railway delete warning: ${data.errors.map((e: any) => e.message).join(', ')}`);
          }
        } catch (error) {
          // For destroy operations, we typically don't throw if the service is already gone
          console.warn(`Railway destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: RailwaySandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('Railway runCode method not implemented yet');
      },

      runCommand: async (_sandbox: RailwaySandbox, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('Railway runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: RailwaySandbox) => {
        throw new Error('Railway getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: RailwaySandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('Railway getUrl method not implemented yet');
      },

      },



    }
});

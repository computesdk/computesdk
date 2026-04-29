/**
 * AVM Provider - Factory-based Implementation
 */

import { defineProvider } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

interface AVMSandbox {
  id: string;
  name: string;
  created_at: string;
  cpu: number;
  memory: number;
  status: string;
  volumes?: Array<{ volume_id: string; mount_path: string; volume_name: string; }>;
}

type AVMSandboxListItem = Pick<AVMSandbox, 'id' | 'name' | 'created_at' | 'cpu' | 'memory' | 'status' | 'volumes'>;

export interface AVMConfig {
  /** AVM API key - if not provided, will fallback to AVM_API_KEY environment variable */
  apiKey?: string;
}

export interface AVMCreateOptions extends CreateSandboxOptions {
  image?: string;
  name?: string;
  resources?: { cpus?: number; memory?: number; };
  volumes?: Array<{ volume_name: string; mount_path: string; }>;
}

export const getAndValidateCredentials = (config: AVMConfig) => {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.AVM_API_KEY) || '';
  if (!apiKey) {
    throw new Error('Missing AVM API key. Provide apiKey in config or set AVM_API_KEY environment variable.');
  }
  return { apiKey };
};

export const fetchAVM = async (apiKey: string, endpoint: string, options: RequestInit = {}) => {
  const url = `https://api.avm.codes/v1${endpoint}`;
  const requestOptions: RequestInit = {
    method: 'GET',
    ...options,
    headers: { 'Accept': 'application/json', 'x-api-key': apiKey, ...(options.headers || {}) }
  };
  const response = await fetch(url, requestOptions);
  if (!response.ok) throw new Error(`AVM API error: ${response.status} ${response.statusText}`);
  if (response.status === 204) return {};
  return response.json();
};

export const avm = defineProvider<AVMSandbox, AVMConfig>({
  name: 'avm',
  methods: {
    sandbox: {
      create: async (config: AVMConfig, options?: AVMCreateOptions) => {
        const { apiKey } = getAndValidateCredentials(config);
        try {
          const createSandboxData = {
            name: options?.name || `computesdk-${Date.now()}`,
            image: options?.image || 'node:alpine',
            resources: { cpus: options?.resources?.cpus || 0.25, memory: options?.resources?.memory || 512 },
            ...(options?.volumes && { volumes: options.volumes }),
            ...(options?.envs && { env_vars: options.envs })
          };
          const responseData = await fetchAVM(apiKey, '/sandboxes/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createSandboxData)
          });
          if (!responseData || !responseData.id) {
            throw new Error(`Sandbox ID is undefined. Full response: ${JSON.stringify(responseData, null, 2)}`);
          }
          const avmSandbox: AVMSandbox = {
            id: responseData.id, name: responseData.name, created_at: responseData.created_at,
            cpu: responseData.cpu, memory: responseData.memory, status: responseData.status, volumes: responseData.volumes
          };
          return { sandbox: avmSandbox, sandboxId: responseData.id };
        } catch (error) {
          throw new Error(`Failed to create AVM sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: AVMConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);
        try {
          const responseData = await fetchAVM(apiKey, `/sandboxes/${sandboxId}/logs`);
          if (!responseData) return null;
          return { sandbox: responseData as unknown as AVMSandbox, sandboxId };
        } catch (error) {
          if (error instanceof Error && error.message.includes('404')) return null;
          throw new Error(`Failed to get AVM sandbox logs: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: AVMConfig) => {
        const { apiKey } = getAndValidateCredentials(config);
        try {
          const responseData = await fetchAVM(apiKey, '/sandboxes/list');
          const items = responseData?.data || [];
          return items.map((sandbox: AVMSandboxListItem) => ({
            sandbox: { id: sandbox.id, name: sandbox.name, created_at: sandbox.created_at, cpu: sandbox.cpu, memory: sandbox.memory, status: sandbox.status, volumes: sandbox.volumes } as AVMSandbox,
            sandboxId: sandbox.id
          }));
        } catch (error) {
          throw new Error(`Failed to list AVM sandboxes: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      destroy: async (config: AVMConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);
        try {
          await fetchAVM(apiKey, `/sandboxes/${sandboxId}/delete`, { method: 'DELETE' });
        } catch (error) {
          console.warn(`AVM destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCommand: async (_sandbox: AVMSandbox, _command: string, _options?: RunCommandOptions) => {
        throw new Error('AVM runCommand method not implemented yet');
      },
      getInfo: async (_sandbox: AVMSandbox) => {
        throw new Error('AVM getInfo method not implemented yet');
      },
      getUrl: async (_sandbox: AVMSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('AVM getUrl method not implemented yet');
      },
    },
  },
});

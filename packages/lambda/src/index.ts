/**
 * Lambda Provider - Factory-based Implementation
 */

import { defineProvider } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/**
 * Lambda sandbox interface
 */
interface LambdaSandbox {
  instanceId: string;
  regionName: string;
  instanceTypeName: string;
}

export interface LambdaConfig {
  /** Lambda API key - if not provided, will fallback to LAMBDA_API_KEY environment variable */
  apiKey?: string;
  /** Lambda Region Name - if not provided, will fallback to LAMBDA_REGION_NAME environment variable */
  regionName?: string;
  /** Lambda Instance Type Name - if not provided, will fallback to LAMBDA_INSTANCE_TYPE_NAME environment variable */
  instanceTypeName?: string;
  /** Lambda SSH Key Name - if not provided, will fallback to LAMBDA_SSH_KEY_NAME environment variable */
  sshKeyName?: string;
}

export const getAndValidateCredentials = (config: LambdaConfig) => {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.LAMBDA_API_KEY) || '';
  const regionName = config.regionName || (typeof process !== 'undefined' && process.env?.LAMBDA_REGION_NAME) || '';
  const instanceTypeName = config.instanceTypeName || (typeof process !== 'undefined' && process.env?.LAMBDA_INSTANCE_TYPE_NAME) || '';
  const sshKeyName = config.sshKeyName || (typeof process !== 'undefined' && process.env?.LAMBDA_SSH_KEY_NAME) || '';

  if (!apiKey) {
    throw new Error(
      'Missing Lambda API key. Provide apiKey in config or set LAMBDA_API_KEY environment variable.'
    );
  }

  if (!regionName) {
    throw new Error(
      'Missing Lambda Region Name. Provide regionName in config or set LAMBDA_REGION_NAME environment variable.'
    );
  }

  if (!instanceTypeName) {
    throw new Error(
      'Missing Lambda Instance Type Name. Provide instanceTypeName in config or set LAMBDA_INSTANCE_TYPE_NAME environment variable.'
    );
  }

  if (!sshKeyName) {
    throw new Error(
      'Missing Lambda SSH Key Name. Provide sshKeyName in config or set LAMBDA_SSH_KEY_NAME environment variable.'
    );
  }

  return { apiKey, regionName, instanceTypeName, sshKeyName };
};

const LAMBDA_API_ENDPOINTS = {
  LAUNCH_INSTANCE: 'https://cloud.lambda.ai/api/v1/instance-operations/launch',
  LIST_INSTANCES: 'https://cloud.lambda.ai/api/v1/instances',
  GET_INSTANCE: (instanceId: string) => `https://cloud.lambda.ai/api/v1/instances/${instanceId}`,
  TERMINATE_INSTANCES: 'https://cloud.lambda.ai/api/v1/instance-operations/terminate'
};

const handleLambdaAPIError = (response: Response, data?: any) => {
  if (!response.ok) {
    let errorMessage;
    if (data?.error) {
      if (typeof data.error === 'object' && data.error.message) {
        errorMessage = `${data.error.message}${data.error.suggestion ? ` ${data.error.suggestion}` : ''} (${data.error.code || 'unknown'})`;
      } else {
        errorMessage = JSON.stringify(data.error);
      }
    } else {
      errorMessage = data?.message || `HTTP ${response.status} ${response.statusText}`;
    }
    throw new Error(`Lambda API error: ${errorMessage}`);
  }
};

export const fetchLambda = async (
  apiKey: string,
  endpoint: string,
  options: {
    method?: string;
    body?: any;
  } = {}
) => {
  const { method = 'GET', body } = options;
  
  const response = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json();
  handleLambdaAPIError(response, data);
  return data;
};

/**
 * Create a Lambda provider instance using the factory pattern
 */
export const lambda = defineProvider<LambdaSandbox, LambdaConfig>({
  name: 'lambda',
  methods: {
    sandbox: {
      create: async (config: LambdaConfig, options?: CreateSandboxOptions) => {
        const { apiKey, regionName, instanceTypeName, sshKeyName } = getAndValidateCredentials(config);

        try {
          const runtime = (options as any)?.runtime;
          const dockerImage = runtime === 'python' ? 'python:alpine' : 'node:alpine';
          const userData = `#!/bin/bash
apt-get update
apt-get install -y docker.io
systemctl start docker
systemctl enable docker
docker pull ${dockerImage}
docker run -d --name compute-app ${dockerImage} tail -f /dev/null`;

          const launchBody = {
            region_name: regionName,
            instance_type_name: instanceTypeName,
            ssh_key_names: [sshKeyName],
            name: `compute-${runtime || 'node'}-instance`,
            user_data: userData
          };

          const responseData = await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.LAUNCH_INSTANCE, {
            method: 'POST',
            body: launchBody
          });
          
          const instanceIds = responseData?.data?.instance_ids;
          if (!instanceIds || !Array.isArray(instanceIds) || instanceIds.length === 0) {
            throw new Error(`No instance IDs returned from Lambda API. Full response: ${JSON.stringify(responseData)}`);
          }

          const instanceId = instanceIds[0];
          const lambdaSandbox: LambdaSandbox = { instanceId, regionName, instanceTypeName };

          return { sandbox: lambdaSandbox, sandboxId: instanceId };
        } catch (error) {
          throw new Error(`Failed to create Lambda sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: LambdaConfig, sandboxId: string) => {
        const { apiKey, regionName, instanceTypeName } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.GET_INSTANCE(sandboxId));
          const instance = responseData?.data;
          if (!instance || !instance.id) return null;

          const lambdaSandbox: LambdaSandbox = { instanceId: instance.id, regionName, instanceTypeName };
          return { sandbox: lambdaSandbox, sandboxId: instance.id };
        } catch (error) {
          if (error instanceof Error && (error.message.includes('404') || error.message.includes('Not Found'))) {
            return null;
          }
          throw new Error(`Failed to get Lambda sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      
      list: async (config: LambdaConfig) => {
        const { apiKey, regionName, instanceTypeName } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.LIST_INSTANCES);
          const instances = responseData?.data || [];

          if (!Array.isArray(instances)) {
            throw new Error(`Expected instances array, got: ${typeof instances}`);
          }

          return instances.map((instance: any) => ({
            sandbox: { instanceId: instance.id, regionName, instanceTypeName } as LambdaSandbox,
            sandboxId: instance.id
          }));
        } catch (error) {
          throw new Error(`Failed to list Lambda sandboxes: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      destroy: async (config: LambdaConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);
        try {
          await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.TERMINATE_INSTANCES, {
            method: 'POST',
            body: { instance_ids: [sandboxId] }
          });
        } catch (error) {
          console.warn(`Lambda destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCommand: async (_sandbox: LambdaSandbox, _command: string, _options?: RunCommandOptions) => {
        throw new Error('Lambda runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: LambdaSandbox) => {
        throw new Error('Lambda getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: LambdaSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('Lambda getUrl method not implemented yet');
      },
    },
  },
});

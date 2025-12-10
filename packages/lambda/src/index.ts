/**
 * Lambda Provider - Factory-based Implementation
 * 
 * Curl Command to start instance with Node:Alpine
 * curl --request POST \
  --url 'https://cloud.lambda.ai/api/v1/instance-operations/launch' \
  --header 'Authorization: Bearer LAMBDA_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "region_name": LAMBDA_REGION_NAME,
    "instance_type_name": LAMBDA_INSTANCE_TYPE_NAME,
    "ssh_key_names": ["LAMBDA_SSH_KEY_NAME"],
    "name": "node-alpine-instance",
    "user_data": "#!/bin/bash\napt-get update\napt-get install -y docker.io\nsystemctl start docker\nsystemctl enable docker\ndocker pull node:alpine\ndocker run -d --name node-app node:alpine tail -f /dev/null"
  }'
  *
  * Curl Command to list instances
  * curl --request GET \
  --url 'https://cloud.lambda.ai/api/v1/instances' \
  --header 'Authorization: Bearer LAMBDA_API_KEY'
  *
  * Curl Command to getById()
  * curl --request GET \
  --url 'https://cloud.lambda.ai/api/v1/instances/<INSTANCE-ID>' \
  --header 'Authorization: Bearer LAMBDA_API_KEY'
  *
  * Curl Command to Destroy Instance (terminate)
  * curl --request POST \
  --url 'https://cloud.lambda.ai/api/v1/instance-operations/terminate' \
  --header 'Authorization: Bearer LAMBDA_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "instance_ids": ["<YOUR-INSTANCE-ID>"]
  }'
 */

import { createProvider } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

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
      // Handle Lambda API error format: { "error": { "code": "...", "message": "...", "suggestion": "..." } }
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

  // Handle Lambda API errors
  handleLambdaAPIError(response, data);

  return data;
};



/**
 * Create a Lambda provider instance using the factory pattern
 */
export const lambda = createProvider<LambdaSandbox, LambdaConfig>({
  name: 'lambda',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: LambdaConfig, options?: CreateSandboxOptions) => {
        const { apiKey, regionName, instanceTypeName, sshKeyName } = getAndValidateCredentials(config);

        try {
          const dockerImage = options?.runtime === 'node' ? 'node:alpine' : 'python:alpine';
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
            name: `compute-${options?.runtime || 'node'}-instance`,
            user_data: userData
          };

          const responseData = await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.LAUNCH_INSTANCE, {
            method: 'POST',
            body: launchBody
          });
          
          // Lambda API returns instance_ids as an array
          const instanceIds = responseData?.data?.instance_ids;
          if (!instanceIds || !Array.isArray(instanceIds) || instanceIds.length === 0) {
            throw new Error(`No instance IDs returned from Lambda API. Full response: ${JSON.stringify(responseData)}`);
          }

          // Take the first instance ID (should only be one for single instance creation)
          const instanceId = instanceIds[0];

          const lambdaSandbox: LambdaSandbox = {
            instanceId,
            regionName,
            instanceTypeName,
          };

          return {
            sandbox: lambdaSandbox,
            sandboxId: instanceId
          };
        } catch (error) {
          throw new Error(
            `Failed to create Lambda sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: LambdaConfig, sandboxId: string) => {
        const { apiKey, regionName, instanceTypeName } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.GET_INSTANCE(sandboxId));
          
          // Lambda API returns the instance directly in data (single instance, not array)
          const instance = responseData?.data;
          if (!instance) {
            return null;
          }
          
          if (!instance.id) {
            throw new Error('Instance data is missing ID from Lambda response');
          }

          const lambdaSandbox: LambdaSandbox = {
            instanceId: instance.id,
            regionName,
            instanceTypeName,
          };

          return {
            sandbox: lambdaSandbox,
            sandboxId: instance.id
          };
        } catch (error) {
          // Return null for 404s (instance not found)
          if (error instanceof Error && (error.message.includes('404') || error.message.includes('Not Found'))) {
            return null;
          }
          throw new Error(
            `Failed to get Lambda sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      
      list: async (config: LambdaConfig) => {
        const { apiKey, regionName, instanceTypeName } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.LIST_INSTANCES);
          
          // Lambda API returns instances directly in data array
          const instances = responseData?.data || [];
          
          if (!Array.isArray(instances)) {
            throw new Error(`Expected instances array, got: ${typeof instances}`);
          }
          
          // Transform each instance into the expected format
          const sandboxes = instances.map((instance: any) => {
            const lambdaSandbox: LambdaSandbox = {
              instanceId: instance.id,
              regionName,
              instanceTypeName,
            };

            return {
              sandbox: lambdaSandbox,
              sandboxId: instance.id
            };
          });

          return sandboxes;
        } catch (error) {
          throw new Error(
            `Failed to list Lambda sandboxes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: LambdaConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const terminateBody = {
            instance_ids: [sandboxId]
          };

          await fetchLambda(apiKey, LAMBDA_API_ENDPOINTS.TERMINATE_INSTANCES, {
            method: 'POST',
            body: terminateBody
          });
        } catch (error) {
          // For destroy operations, we typically don't throw if the instance is already gone
          console.warn(`Lambda destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: LambdaSandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('Lambda runCode method not implemented yet');
      },

      runCommand: async (_sandbox: LambdaSandbox, _command: string, _args?: string[], _options?: RunCommandOptions) => {
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

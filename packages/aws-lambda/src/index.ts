/**
 * AWS Lambda Provider - Factory-based Implementation
 */

import { createProvider } from 'computesdk';
import type { Runtime, CreateSandboxOptions, RunCommandOptions } from 'computesdk';
import {
  LambdaClient,
  CreateFunctionCommand,
  GetFunctionCommand,
  ListFunctionsCommand,
  DeleteFunctionCommand,
  ResourceNotFoundException,
  Runtime as AWSRuntime,
} from '@aws-sdk/client-lambda';
import JSZip from 'jszip';

/**
 * AWS Lambda sandbox interface
 */
interface LambdaSandbox {
  functionName: string;
  functionArn: string;
  runtime: string;
}

export interface LambdaConfig {
  /** AWS Access Key ID - if not provided, will fallback to AWS_ACCESS_KEY_ID env var */
  accessKeyId?: string;
  /** AWS Secret Access Key - if not provided, will fallback to AWS_SECRET_ACCESS_KEY env var */
  secretAccessKey?: string;
  /** AWS Region - if not provided, will fallback to AWS_REGION env var (default: us-east-2) */
  region?: string;
  /** IAM Role ARN for Lambda execution - if not provided, will fallback to AWS_LAMBDA_ROLE_ARN env var */
  roleArn?: string;
  /** Function name prefix (default: 'computesdk') */
  functionNamePrefix?: string;
}

export const getAndValidateCredentials = (config: LambdaConfig) => {
  const accessKeyId = config.accessKeyId || (typeof process !== 'undefined' && process.env?.AWS_ACCESS_KEY_ID) || '';
  const secretAccessKey = config.secretAccessKey || (typeof process !== 'undefined' && process.env?.AWS_SECRET_ACCESS_KEY) || '';
  const region = config.region || (typeof process !== 'undefined' && process.env?.AWS_REGION) || 'us-east-2';
  const roleArn = config.roleArn || (typeof process !== 'undefined' && process.env?.AWS_LAMBDA_ROLE_ARN) || '';
  const functionNamePrefix = config.functionNamePrefix || 'computesdk';

  if (!roleArn) {
    throw new Error(
      'Missing Lambda IAM Role ARN. Provide roleArn in config or set AWS_LAMBDA_ROLE_ARN environment variable.'
    );
  }

  // Build credentials object only if both accessKeyId and secretAccessKey are provided
  // Otherwise, let the SDK use the default credential chain
  const credentials = accessKeyId && secretAccessKey
    ? {
        accessKeyId,
        secretAccessKey,
      }
    : undefined;

  return {
    region,
    roleArn,
    functionNamePrefix,
    credentials,
  };
};

/**
 * Create a Lambda client instance
 */
const createLambdaClient = (config: LambdaConfig): LambdaClient => {
  const { region, credentials } = getAndValidateCredentials(config);
  
  return new LambdaClient({
    region,
    ...(credentials && { credentials }),
  });
};

/**
 * Generate a unique function name
 */
const generateFunctionName = (prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Map ComputeSDK runtime to AWS Lambda runtime
 */
const mapRuntimeToAWS = (runtime?: Runtime): AWSRuntime => {
  // Default to Node.js 20.x if not specified
  if (!runtime || runtime === 'node') {
    return 'nodejs20.x' as AWSRuntime;
  }
  if (runtime === 'python') {
    return 'python3.12' as AWSRuntime;
  }
  // Add more mappings as needed
  throw new Error(`Unsupported runtime: ${runtime}. Supported runtimes: node, python`);
};

/**
 * Create a ZIP file containing Lambda handler code using JSZip
 */
const createLambdaZip = async (): Promise<Buffer> => {
  const handlerCode = `exports.handler = async (event) => {
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Hello from Node.js Lambda!',
            nodeVersion: process.version,
            input: event
        })
    };
};`;

  const zip = new JSZip();
  zip.file('index.js', handlerCode);
  
  return await zip.generateAsync({ 
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
};

/**
 * Create an AWS Lambda provider instance using the factory pattern
 */
export const awsLambda = createProvider<LambdaSandbox, LambdaConfig>({
  name: 'aws-lambda',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: LambdaConfig, options?: CreateSandboxOptions) => {
        const { roleArn, functionNamePrefix } = getAndValidateCredentials(config);
        const client = createLambdaClient(config);

        try {
          const functionName = generateFunctionName(functionNamePrefix);
          const runtime = mapRuntimeToAWS(options?.runtime);
          const zipBuffer = await createLambdaZip();

          const command = new CreateFunctionCommand({
            FunctionName: functionName,
            Runtime: runtime,
            Role: roleArn,
            Handler: 'index.handler',
            Code: {
              ZipFile: zipBuffer,
            },
            Timeout: 30,
            MemorySize: 128,
          });

          const response = await client.send(command);

          if (!response.FunctionArn || !response.FunctionName) {
            throw new Error('Function ARN or name is undefined in response');
          }

          const lambdaSandbox: LambdaSandbox = {
            functionName: response.FunctionName,
            functionArn: response.FunctionArn,
            runtime: response.Runtime || runtime,
          };

          return {
            sandbox: lambdaSandbox,
            sandboxId: response.FunctionName,
          };
        } catch (error) {
          throw new Error(
            `Failed to create Lambda function: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: LambdaConfig, sandboxId: string) => {
        const client = createLambdaClient(config);

        try {
          const command = new GetFunctionCommand({
            FunctionName: sandboxId,
          });

          const response = await client.send(command);

          if (!response.Configuration) {
            return null;
          }

          const funcConfig = response.Configuration;

          if (!funcConfig.FunctionName || !funcConfig.FunctionArn) {
            return null;
          }

          const lambdaSandbox: LambdaSandbox = {
            functionName: funcConfig.FunctionName,
            functionArn: funcConfig.FunctionArn,
            runtime: funcConfig.Runtime || 'unknown',
          };

          return {
            sandbox: lambdaSandbox,
            sandboxId: funcConfig.FunctionName,
          };
        } catch (error) {
          if (error instanceof ResourceNotFoundException) {
            return null;
          }
          throw new Error(
            `Failed to get Lambda function: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      
      list: async (config: LambdaConfig) => {
        const client = createLambdaClient(config);

        try {
          const command = new ListFunctionsCommand({});

          const response = await client.send(command);

          const functions = response.Functions || [];

          function hasFunctionNameAndArn(
            func: typeof functions[number]
          ): func is { FunctionName: string; FunctionArn: string } & typeof func {
            return !!(func.FunctionName && func.FunctionArn);
          }

          const sandboxes = functions
            .filter(hasFunctionNameAndArn)
            .map(func => {
              const lambdaSandbox: LambdaSandbox = {
                functionName: func.FunctionName,
                functionArn: func.FunctionArn,
                runtime: func.Runtime || 'unknown',
              };

              return {
                sandbox: lambdaSandbox,
                sandboxId: func.FunctionName,
              };
            });

          return sandboxes;
        } catch (error) {
          throw new Error(
            `Failed to list Lambda functions: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: LambdaConfig, sandboxId: string) => {
        const client = createLambdaClient(config);

        try {
          const command = new DeleteFunctionCommand({
            FunctionName: sandboxId,
          });

          await client.send(command);
        } catch (error) {
          // For destroy operations, we typically don't throw if the function is already gone
          if (error instanceof ResourceNotFoundException) {
            console.warn(`Lambda function ${sandboxId} not found - may already be deleted`);
          } else {
            console.warn(`Lambda destroy warning: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: LambdaSandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('AWS Lambda runCode method not implemented yet');
      },

      runCommand: async (_sandbox: LambdaSandbox, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('AWS Lambda runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: LambdaSandbox) => {
        throw new Error('AWS Lambda getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: LambdaSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('AWS Lambda getUrl method not implemented yet');
      },

    },
  },
});

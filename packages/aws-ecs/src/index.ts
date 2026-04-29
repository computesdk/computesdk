/**
 * AWS ECS Fargate Provider - Factory-based Implementation
 */

import { defineProvider } from '@computesdk/provider';
import type { CreateSandboxOptions, RunCommandOptions } from '@computesdk/provider';
import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';

/**
 * Fargate sandbox interface
 */
interface FargateSandbox {
  taskArn: string;
  clusterArn: string;
  taskId: string;
}

export interface FargateConfig {
  /** AWS Access Key ID - falls back to AWS_ACCESS_KEY_ID env var or default credential chain */
  accessKeyId?: string;
  /** AWS Secret Access Key - falls back to AWS_SECRET_ACCESS_KEY env var or default credential chain */
  secretAccessKey?: string;
  /** AWS Region - falls back to AWS_REGION env var */
  region?: string;
  /** ECS Cluster name or ARN */
  cluster: string;
  /** Task definition family name or ARN */
  taskDefinition: string;
  /** VPC Subnet IDs for task networking */
  subnets: string[];
  /** Security Group IDs for task networking */
  securityGroups: string[];
  /** Whether to assign a public IP (default: true) */
  assignPublicIp?: boolean;
  /** Container name in the task definition (default: 'sandbox') */
  containerName?: string;
}

export const getAndValidateCredentials = (config: FargateConfig) => {
  const region = config.region || process.env?.AWS_REGION || 'us-east-1';
  const cluster = config.cluster;
  const taskDefinition = config.taskDefinition;
  const subnets = config.subnets;
  const securityGroups = config.securityGroups;

  if (!cluster) {
    throw new Error('Missing ECS cluster. Provide cluster in config.');
  }

  if (!taskDefinition) {
    throw new Error('Missing ECS task definition. Provide taskDefinition in config.');
  }

  if (!subnets || subnets.length === 0) {
    throw new Error('Missing subnets. Provide at least one subnet in config.');
  }

  if (!securityGroups || securityGroups.length === 0) {
    throw new Error('Missing security groups. Provide at least one security group in config.');
  }

  const credentials = config.accessKeyId && config.secretAccessKey
    ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      }
    : undefined;

  return {
    region,
    cluster,
    taskDefinition,
    subnets,
    securityGroups,
    credentials,
    assignPublicIp: config.assignPublicIp ?? true,
    containerName: config.containerName || 'sandbox',
  };
};

/**
 * Create an ECS client instance
 */
const createECSClient = (config: FargateConfig): ECSClient => {
  const { region, credentials } = getAndValidateCredentials(config);
  
  return new ECSClient({
    region,
    ...(credentials && { credentials }),
  });
};

/**
 * Extract task ID from task ARN
 */
const extractTaskId = (taskArn: string): string => {
  const parts = taskArn.split('/');
  return parts[parts.length - 1];
};

/**
 * Create an AWS ECS Fargate provider instance using the factory pattern
 */
export const fargate = defineProvider<FargateSandbox, FargateConfig>({
  name: 'fargate',
  methods: {
    sandbox: {
      create: async (config: FargateConfig, options?: CreateSandboxOptions) => {
        const {
          cluster,
          taskDefinition,
          subnets,
          securityGroups,
          assignPublicIp,
          containerName,
        } = getAndValidateCredentials(config);
        
        const client = createECSClient(config);

        try {
          const command = new RunTaskCommand({
            cluster,
            taskDefinition,
            launchType: 'FARGATE',
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets,
                securityGroups,
                assignPublicIp: assignPublicIp ? 'ENABLED' : 'DISABLED',
              },
            },
            ...(containerName && {
              overrides: {
                containerOverrides: [
                  {
                    name: containerName,
                  },
                ],
              },
            }),
          });

          const response = await client.send(command);

          if (!response.tasks || response.tasks.length === 0) {
            const failures = response.failures?.map(f => `${f.reason}: ${f.detail}`).join(', ');
            throw new Error(`No task created. Failures: ${failures || 'unknown'}`);
          }

          const task = response.tasks[0];
          
          if (!task.taskArn) {
            throw new Error('Task ARN is undefined in response');
          }

          const fargateSandbox: FargateSandbox = {
            taskArn: task.taskArn,
            clusterArn: task.clusterArn || cluster,
            taskId: extractTaskId(task.taskArn),
          };

          return {
            sandbox: fargateSandbox,
            sandboxId: task.taskArn,
          };
        } catch (error) {
          throw new Error(
            `Failed to create Fargate sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: FargateConfig, sandboxId: string) => {
        const { cluster } = getAndValidateCredentials(config);
        const client = createECSClient(config);

        try {
          const command = new DescribeTasksCommand({
            cluster,
            tasks: [sandboxId],
          });

          const response = await client.send(command);

          if (!response.tasks || response.tasks.length === 0) {
            return null;
          }

          const task = response.tasks[0];
          
          if (!task.taskArn) {
            throw new Error('Task ARN is missing from response');
          }

          const fargateSandbox: FargateSandbox = {
            taskArn: task.taskArn,
            clusterArn: task.clusterArn || cluster,
            taskId: extractTaskId(task.taskArn),
          };

          return {
            sandbox: fargateSandbox,
            sandboxId: task.taskArn,
          };
        } catch (error) {
          if (error instanceof Error && 
              (error.message.includes('MISSING') || error.message.includes('not found'))) {
            return null;
          }
          throw new Error(
            `Failed to get Fargate sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: FargateConfig) => {
        const { cluster } = getAndValidateCredentials(config);
        const client = createECSClient(config);

        try {
          const listCommand = new ListTasksCommand({
            cluster,
            desiredStatus: 'RUNNING',
          });

          const listResponse = await client.send(listCommand);
          const taskArns = listResponse.taskArns || [];

          if (taskArns.length === 0) {
            return [];
          }

          const describeCommand = new DescribeTasksCommand({
            cluster,
            tasks: taskArns,
          });

          const describeResponse = await client.send(describeCommand);
          const tasks = describeResponse.tasks || [];

          return tasks
            .filter(task => task.taskArn)
            .map(task => ({
              sandbox: {
                taskArn: task.taskArn!,
                clusterArn: task.clusterArn || cluster,
                taskId: extractTaskId(task.taskArn!),
              } as FargateSandbox,
              sandboxId: task.taskArn!,
            }));
        } catch (error) {
          throw new Error(
            `Failed to list Fargate sandboxes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: FargateConfig, sandboxId: string) => {
        const { cluster } = getAndValidateCredentials(config);
        const client = createECSClient(config);

        try {
          const command = new StopTaskCommand({
            cluster,
            task: sandboxId,
            reason: 'User requested termination',
          });

          await client.send(command);
        } catch (error) {
          if (error instanceof Error && 
              (error.message.includes('MISSING') || 
               error.message.includes('not found') ||
               error.message.includes('STOPPED'))) {
            console.warn(`Fargate destroy warning: Task already stopped or not found`);
            return;
          }
          console.warn(
            `Fargate destroy warning: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (_sandbox: FargateSandbox, _command: string, _options?: RunCommandOptions) => {
        throw new Error('Fargate runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: FargateSandbox) => {
        throw new Error('Fargate getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: FargateSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('Fargate getUrl method not implemented yet');
      },
    },
  },
});

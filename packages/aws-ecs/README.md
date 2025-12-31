# @computesdk/aws

AWS ECS Fargate provider for ComputeSDK that enables creating and managing containerized sandboxes on AWS infrastructure.

## Installation

```bash
npm install @computesdk/aws
```

## Configuration

The AWS provider requires the following environment variables and AWS resources:

```bash
# AWS Credentials (or use IAM roles/profiles)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1

# Required AWS Resources
AWS_ECS_CLUSTER=your-ecs-cluster
AWS_TASK_DEFINITION=your-task-definition
AWS_SUBNETS=subnet-xxx,subnet-yyy,subnet-zzz
AWS_SECURITY_GROUPS=sg-xxx
```

## Usage

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects AWS ECS from AWS credentials and environment variables
const sandbox = await compute.sandbox.create();
console.log(`Created sandbox: ${sandbox.id}`);

// List all running sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy the sandbox
await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { fargate } from '@computesdk/aws';

const compute = fargate({
  cluster: 'my-ecs-cluster',
  taskDefinition: 'my-task-definition',
  subnets: ['subnet-12345', 'subnet-67890'],
  securityGroups: ['sg-12345'],
  region: 'us-east-1'
});

// Create a sandbox (ECS task)
const sandbox = await compute.sandbox.create({ runtime: 'node' });
console.log(`Created sandbox: ${sandbox.id}`);

// List all running sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy the sandbox
await sandbox.destroy();
```

## Currently Implemented

### Sandbox Operations
- **create()** - Creates a new ECS Fargate task
- **getById()** - Retrieves a specific ECS task by ARN
- **list()** - Lists all running ECS tasks in the cluster
- **destroy()** - Stops an ECS task

### Configuration Options
- **cluster** - ECS cluster name or ARN (required)
- **taskDefinition** - Task definition family name or ARN (required)
- **subnets** - VPC subnet IDs for task networking (required)
- **securityGroups** - Security group IDs for task networking (required)
- **accessKeyId** - AWS access key (optional - falls back to credential chain)
- **secretAccessKey** - AWS secret key (optional - falls back to credential chain)
- **region** - AWS region (optional - defaults to AWS_REGION env var or us-east-1)
- **assignPublicIp** - Whether to assign public IP (optional - defaults to true)
- **containerName** - Container name in task definition (optional - defaults to 'sandbox')

## Prerequisites

Before using this provider, you need to set up:

1. **ECS Cluster**: A Fargate-compatible ECS cluster
2. **Task Definition**: A task definition with your desired container image
3. **VPC Networking**: Subnets and security groups for task networking
4. **IAM Permissions**: Appropriate permissions to create/manage ECS tasks

## Notes

- Tasks use AWS Fargate launch type (serverless containers)
- Container images are specified in the task definition, not at runtime
- The `runtime` parameter is acknowledged but actual environment depends on task definition
- Tasks are immediately stopped when destroyed
- All operations use the AWS SDK v3 for ECS
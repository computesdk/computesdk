# @computesdk/aws-lambda

AWS Lambda provider for ComputeSDK - execute code in serverless Lambda functions.

## Installation

```bash
npm install @computesdk/aws-lambda
# or
pnpm add @computesdk/aws-lambda
# or
yarn add @computesdk/aws-lambda
```

## Prerequisites

Before using this provider, you need:

1. **AWS Account** with Lambda access
2. **IAM Role** for Lambda execution with appropriate permissions
3. **AWS Credentials** (Access Key ID and Secret Access Key) OR configured AWS CLI/IAM role

### Required IAM Role

The Lambda execution role must have these permissions:
- `lambda:CreateFunction`
- `lambda:GetFunction`
- `lambda:ListFunctions`
- `lambda:DeleteFunction`
- Basic Lambda execution permissions (logging to CloudWatch, etc.)

Example IAM role ARN: `arn:aws:iam::123456789012:role/lambda-execution-role`

## Usage

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects AWS Lambda from AWS credentials and AWS_LAMBDA_ROLE_ARN
const sandbox = await compute.sandbox.create();
console.log('Created function:', sandbox.id);

// List all functions
const allFunctions = await compute.sandbox.list();
console.log('All functions:', allFunctions.length);

// Destroy the function
await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { awsLambda } from '@computesdk/aws-lambda';

const compute = awsLambda({
  roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
  region: 'us-east-2', // optional, defaults to us-east-2
  accessKeyId: 'YOUR_ACCESS_KEY', // optional, uses AWS SDK credential chain
  secretAccessKey: 'YOUR_SECRET_KEY', // optional, uses AWS SDK credential chain
  functionNamePrefix: 'my-app', // optional, defaults to 'computesdk'
});

// Create a Lambda function
const sandbox = await compute.sandbox.create({ runtime: 'node' });
console.log('Created function:', sandbox.id);

// List all functions
const allFunctions = await compute.sandbox.list();
console.log('All functions:', allFunctions.length);

// Destroy the function
await sandbox.destroy();
```

## Configuration

### LambdaConfig

```typescript
interface LambdaConfig {
  /** AWS Access Key ID - if not provided, falls back to AWS_ACCESS_KEY_ID env var */
  accessKeyId?: string;
  
  /** AWS Secret Access Key - if not provided, falls back to AWS_SECRET_ACCESS_KEY env var */
  secretAccessKey?: string;
  
  /** AWS Region - if not provided, falls back to AWS_REGION env var (default: us-east-2) */
  region?: string;
  
  /** IAM Role ARN for Lambda execution - if not provided, falls back to AWS_LAMBDA_ROLE_ARN env var */
  roleArn?: string;
  
  /** Function name prefix (default: 'computesdk') */
  functionNamePrefix?: string;
}
```

### Environment Variables

Instead of passing credentials in the config, you can use environment variables:

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-2"
export AWS_LAMBDA_ROLE_ARN="arn:aws:iam::123456789012:role/lambda-execution-role"
```

Then initialize with minimal or no config (all values read from environment):

```typescript
// Option 1: Empty config (all from environment variables)
const provider = awsLambda({});

// Option 2: Mix config and environment variables
const provider = awsLambda({
  region: 'us-west-2', // Override region, rest from env
});
```

**Note:** If `roleArn` is not provided in config or environment, an error will be thrown at runtime.

## Supported Methods

### ✅ Implemented

- **`create(options?)`** - Create a new Lambda function
  - Generates a unique function name with configurable prefix
  - Supports `node` (nodejs20.x) and `python` (python3.12) runtimes
  - Creates a basic "Hello World" handler
  - Returns function name, ARN, and runtime

- **`list()`** - List all Lambda functions in the region
  - Returns all functions (no filtering)
  - Returns function name, ARN, and runtime for each

- **`getById(sandboxId)`** - Get a specific Lambda function by name
  - Returns `null` if function doesn't exist
  - Returns function name, ARN, and runtime if found

- **`destroy(sandboxId)`** - Delete a Lambda function
  - Gracefully handles already-deleted functions
  - Logs warnings instead of throwing errors

### ❌ Not Yet Implemented

- `runCode()` - Execute code in the Lambda function
- `runCommand()` - Run shell commands
- `getInfo()` - Get detailed function information
- `getUrl()` - Get function URL (if configured)

## Supported Runtimes

Currently supported runtimes:

- **`node`** → Maps to `nodejs20.x`
- **`python`** → Maps to `python3.12`

Default runtime: `node` (nodejs20.x)

## Function Naming

Created functions follow this naming pattern:
```
{prefix}-{timestamp}-{random}
```

Example: `computesdk-1702345678901-a1b2c3`

This ensures unique, identifiable function names. Customize the prefix:

```typescript
const provider = awsLambda({
  roleArn: 'arn:aws:iam::123456789012:role/lambda-execution-role',
  functionNamePrefix: 'myapp', // Functions will be named: myapp-{timestamp}-{random}
});
```

## Error Handling

The provider throws descriptive errors for:
- Missing required configuration (roleArn)
- AWS API errors during create/list/getById operations
- Unsupported runtime types

The `destroy()` method logs warnings instead of throwing errors, allowing cleanup to proceed even if the function is already deleted.

## AWS SDK Integration

This provider uses the official AWS SDK for JavaScript v3 (`@aws-sdk/client-lambda`), which provides:
- Automatic AWS Signature V4 authentication
- Support for AWS credential chain (IAM roles, profiles, etc.)
- Type-safe API calls
- Automatic retries and error handling


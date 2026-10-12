---
description: >-
  AWS EC2 provider for ComputeSDK - on-demand or Spot EC2 instances from a launch
  template, with commands executed over SSM Run Command.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# AWS EC2

AWS EC2 provider for ComputeSDK. Each sandbox is one EC2 instance launched from your launch template, on-demand
by default or Spot when you opt in. Commands run over
[SSM Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html) (`AWS-RunShellScript`).
There is no agent or gateway on the box and no inbound ports: the preinstalled SSM agent dials out.

## Installation

```bash
npm install @computesdk/aws
```

## Usage

```typescript
import { ec2 } from '@computesdk/aws/ec2';

// On-demand, everything else comes from the launch template
const compute = ec2({ launchTemplate: 'my-template' }); // region from AWS_REGION

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node -v', { env: { CI: '1' }, cwd: '/tmp', timeout: 60_000 });
console.log(result.exitCode, result.stdout);
await sandbox.destroy();
```

### Spot

```typescript
import { ec2, isEc2CapacityError } from '@computesdk/aws/ec2';

const compute = ec2({
  region: 'us-east-2',
  launchTemplate: 'computesdk-market-medium',
  instanceType: [
    'c5d.large', 'm7a.large', 'c6in.large', 'r5a.large', 'm5a.large', 'r5ad.large', 'r5b.large',
    'r5n.large', 'c5a.large', 'r6a.large', 'm5ad.large', 'r6in.large', 'm6in.large',
  ],
  spot: { maxPricePerHour: '0.05' },
});

try {
  const sandbox = await compute.sandbox.create({ name: 'bench-1', metadata: { listing: 'lst_42' } });
} catch (error) {
  if (isEc2CapacityError(error)) console.log('No Spot capacity right now:', error.codes);
  else throw error;
}
```

## Configuration

| Option | Required | Description |
|---|---|---|
| `launchTemplate` | yes | Launch template name or id (`lt-...`) |
| `region` | no | AWS region; falls back to `AWS_REGION` |
| `instanceType` | no | One type, or a list to fall back across. Default: the launch template's |
| `subnetIds` | no | Subnets to fall back across, one per AZ. Default: the launch template's |
| `spot` | no | `true` or `{ maxPricePerHour }` for Spot. Default: on-demand |
| `credentials` | no | `AwsCredentialIdentity` or `AwsCredentialIdentityProvider`. Default: AWS SDK credential chain |
| `launchTemplateVersion` | no | Default `$Default` |

Advanced: `readyTimeoutMs` (default `120000`), `pollIntervalMs` (default `2000`),
`outputS3Bucket` / `outputS3KeyPrefix` (full command output, see below).

The launch template owns the AMI, IMDS settings, root volume, security group, networking, and an instance profile
that allows SSM. The provider never sets those.

A plain on-demand launch (at most one `instanceType`, no `subnetIds`) is a single `RunInstances` call. Spot,
several instance types, or `subnetIds` use an instant EC2 Fleet over every type × subnet pair
(`price-capacity-optimized` for Spot).

If your launch template doesn't pin a subnet, pass `subnetIds`; otherwise AWS falls back to the default VPC.

### Credentials

There are no API keys in config. Pass a credential provider for short-lived credentials, e.g. on Vercel with OIDC:

```typescript
import { awsCredentialsProvider } from '@vercel/functions/oidc';

ec2({ launchTemplate: 'my-template', credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN! }) });
```

## Behavior

- **Sandbox ID** is the EC2 instance ID.
- **Tags**: instances and volumes are tagged `computesdk:managed=true` (IAM policies can be conditioned on it),
  `computesdk:sandbox-name` when `name` is set, and every string `metadata` value (sanitized to EC2 tag limits, max 50 tags).
- **Capacity**: when no instance launches because of capacity, price, or quota errors, `create` throws
  `Ec2CapacityError` (`code: 'AWS_EC2_CAPACITY_UNAVAILABLE'`, `codes`, `errors`). Other fleet failures throw `Ec2FleetError`.
- **Readiness**: `create` returns once the instance is `Online` in SSM. On timeout (`Ec2ReadyTimeoutError`) or any
  error the instance is terminated before throwing. `create({ timeout })` overrides `readyTimeoutMs`.
- **Commands run as root** via `AWS-RunShellScript`. `env` is exported and `cwd` is entered in the same script;
  `timeout` maps to SSM `executionTimeout` (seconds, rounded up). Timed-out commands return exit code `124`.
- **Output limit**: SSM returns at most 24,000 characters each of stdout and stderr inline. Set
  `outputS3Bucket` (the instance profile needs `s3:PutObject` and the caller `s3:GetObject`) to get full output.
- `getById` returns `null` for unknown, terminated/shutting-down, or untagged instances. `list` returns managed
  `pending`/`running` instances. `destroy` is idempotent and refuses to terminate untagged instances.
- `getInstance()` / `getInfo().metadata` expose instance type, AZ, subnet, lifecycle (`spot`/`on-demand`), and launch time.
- Not supported: `getUrl` (no inbound traffic) and the filesystem API.

## Testing

```bash
pnpm test   # unit tests (mocked AWS)

# real AWS: any Ec2Config as JSON
AWS_EC2_INTEGRATION_CONFIG='{"launchTemplate":"my-template","region":"us-east-2","instanceType":"m7a.large"}' pnpm test
```

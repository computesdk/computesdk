---
description: >-
  AWS EC2 provider for ComputeSDK - Spot instances launched through instant EC2
  Fleets, with commands executed over SSM Run Command.
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

AWS EC2 Spot provider for ComputeSDK. Each sandbox is one Spot instance launched through an
[instant EC2 Fleet](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instant-fleet.html); commands run over
[SSM Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html) (`AWS-RunShellScript`).
There is no agent or gateway on the box and no inbound ports: the preinstalled SSM agent dials out.

## Installation

```bash
npm install @computesdk/aws-ec2
```

## Usage

```typescript
import { awsEc2, isAwsEc2CapacityError } from '@computesdk/aws-ec2';

const compute = awsEc2({
  region: 'us-east-2',
  launchTemplateName: 'computesdk-market-medium',
  subnetIds: ['subnet-aaa', 'subnet-bbb', 'subnet-ccc'], // one per AZ
  instanceTypes: [
    'c5d.large', 'm7a.large', 'c6in.large', 'r5a.large', 'm5a.large', 'r5ad.large', 'r5b.large',
    'r5n.large', 'c5a.large', 'r6a.large', 'm5ad.large', 'r6in.large', 'm6in.large',
  ],
  maxPricePerHour: '0.05',
});

try {
  const sandbox = await compute.sandbox.create({ name: 'bench-1', metadata: { listing: 'lst_42' } });
  const result = await sandbox.runCommand('node -v', { env: { CI: '1' }, cwd: '/tmp', timeout: 60_000 });
  console.log(result.exitCode, result.stdout);
  await sandbox.destroy();
} catch (error) {
  if (isAwsEc2CapacityError(error)) {
    console.log('No Spot capacity right now:', error.codes);
  } else {
    throw error;
  }
}
```

## Configuration

| Option | Required | Description |
|---|---|---|
| `region` | yes (or `AWS_REGION`) | AWS region, e.g. `us-east-2` |
| `launchTemplateName` | yes | Launch template with AMI, IMDSv2, root volume, security group, public IPv4, and SSM instance profile |
| `launchTemplateVersion` | no | Defaults to `$Default` |
| `subnetIds` | yes | Subnets to launch into, one per AZ |
| `instanceTypes` | yes | Instance types the fleet may choose from |
| `maxPricePerHour` | no | Fleet `MaxTotalPrice`, e.g. `"0.05"` |
| `credentials` | no | `AwsCredentialIdentity` or `AwsCredentialIdentityProvider`; omitted → default AWS SDK credential chain |
| `readyTimeoutMs` | no | How long `create` waits for SSM `Online` (default `120000`; `create({ timeout })` overrides) |
| `pollIntervalMs` | no | Base poll interval (default `2000`) |
| `outputS3Bucket` / `outputS3KeyPrefix` | no | Send command output to S3 and read full output from there |

The provider never sets AMI, key pair, security groups, network interfaces, or instance profile; those come
from the launch template. Fleet overrides are every `instanceTypes` × `subnetIds` pair with the
`price-capacity-optimized` Spot allocation strategy.

### Credentials

There are no API keys in config. Pass a credential provider for short-lived credentials, e.g. on Vercel with OIDC:

```typescript
import { awsCredentialsProvider } from '@vercel/functions/oidc';

awsEc2({ ...config, credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN! }) });
```

## Behavior

- **Sandbox ID** is the EC2 instance ID.
- **Tags**: instances and volumes are tagged `computesdk:managed=true` (IAM policies can be conditioned on it),
  `computesdk:sandbox-name` when `name` is set, and every string `metadata` value (sanitized to EC2 tag limits, max 50 tags).
- **Capacity**: when the fleet returns no instance and every error is a capacity/price/quota code,
  `create` throws `AwsEc2CapacityError` (`code: 'AWS_EC2_CAPACITY_UNAVAILABLE'`, `codes`, per-override `errors`).
  Other failures throw `AwsEc2FleetError`.
- **Readiness**: `create` returns once the instance is `Online` in SSM. On timeout (`AwsEc2ReadyTimeoutError`) or any
  error the instance is terminated before throwing.
- **Commands run as root** via `AWS-RunShellScript`. `env` is exported and `cwd` is entered in the same script;
  `timeout` maps to SSM `executionTimeout` (seconds, rounded up). Timed-out commands return exit code `124`.
- **Output limit**: SSM returns at most 24,000 characters each of stdout and stderr inline. Configure
  `outputS3Bucket` (the instance profile needs `s3:PutObject` and the caller `s3:GetObject`) to get full output.
- `getById` returns `null` for unknown, terminated/shutting-down, or untagged instances. `list` returns managed
  `pending`/`running` instances. `destroy` is idempotent and refuses to terminate untagged instances.
- `getInstance()` / `getInfo().metadata` expose instance type, AZ, subnet, lifecycle (`spot`/`on-demand`), and launch time.
- Not supported: `getUrl` (no inbound traffic) and the filesystem API.

## Testing

```bash
pnpm test                                    # unit tests (mocked AWS)
AWS_EC2_INTEGRATION=1 AWS_REGION=us-east-2 \
  AWS_EC2_LAUNCH_TEMPLATE=computesdk-market-medium \
  AWS_EC2_SUBNET_IDS=subnet-aaa,subnet-bbb \
  AWS_EC2_INSTANCE_TYPES=c5d.large,m7a.large \
  AWS_EC2_MAX_PRICE_PER_HOUR=0.05 pnpm test  # real Spot instances
```

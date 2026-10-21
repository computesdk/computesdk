# @computesdk/aws

## 1.0.4

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.0.3

### Patch Changes

- 68f3e19: EC2: remove spilled output files when SSM reports a command `Cancelled`, or when partial output after a timeout can't be read back.
- 51ffdd3: aws-ec2: default `HOME` for SSM commands (the agent leaves it unset, which breaks tools like act), and add an optional `getUrl` config hook so an ingress layer can provide preview URLs.

## 1.0.2

### Patch Changes

- df6960f: Add the AWS Bedrock AgentCore Code Interpreter provider at `@computesdk/aws/agentcore` (`import { agentcore } from '@computesdk/aws/agentcore'`), moved from `@computesdk/agentcore`. The provider name stays `agentcore`.
- a646a73: EC2: return full command output without S3. Output past SSM's 24,000-character inline limit is spilled to files on the instance and read back in chunks, capped per stream by the new `maxOutputBytes` (default 4 MiB). `outputS3Bucket` remains the fast path.
- 2b6f707: EC2: fix large stderr being cut to SSM's 8,000-character stderr limit (spill threshold and S3 fallback now use it, and read-back chunks always come back on stdout); remove spilled output files when a command is cancelled at the client deadline.

## 1.0.1

### Patch Changes

- 3dff496: Add `@computesdk/aws` with the EC2 provider at `@computesdk/aws/ec2` (on-demand or Spot instances from a launch template, commands over SSM Run Command)
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

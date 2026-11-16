---
description: >-
  EC2 Firecrab for ComputeSDK - Firecracker microVMs on self-hosted EC2 hosts
  driven by a firecrab control plane. Each sandbox is a real microVM built
  from an OCI image.
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

# EC2 Firecrab

[Firecracker](https://firecracker-microvm.github.io) microVMs on self-hosted AWS EC2, driven by a [firecrab](https://github.com/SteelCrab/firecrab) host — each sandbox is a real microVM carved out of a shared EC2 hypervisor instance rather than a whole EC2 machine per job.

## Installation & Setup

```bash
npm install @computesdk/ec2-firecrab
```

Point the adapter at your firecrab host — off-host callers only need an SSH
target and key; the adapter opens the API tunnel and derives the exec
jumphost itself:

```bash
EC2_FIRECRAB_SSH_TARGET=ubuntu@<host-public-ip>
EC2_FIRECRAB_SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----..."
# or: EC2_FIRECRAB_SSH_KEY_PATH=~/.ssh/firecrab.pem
EC2_FIRECRAB_MICRO_NETWORK=lab          # network name (or use ..._NETWORK_ID for a UUID)
EC2_FIRECRAB_TEMPLATE=catthehacker-ubuntu-act-latest
```

Running on the host itself? Skip the SSH vars and set
`EC2_FIRECRAB_API_URL=http://127.0.0.1:5523` instead.

Host prerequisites: a nested-virtualization EC2 instance (`m8i`/`c8i`/`r8i` families or `.metal` types with `NestedVirtualization=enabled`), firecrab installed, a MicroNetwork whose CIDR doesn't overlap the VPC's, and an imported OCI image. The API is unauthenticated loopback — reach it via SSH/SSM port-forward or run the adapter on the host.

## Usage

```ts
import { ec2Firecrab } from '@computesdk/ec2-firecrab';

const provider = ec2Firecrab({
  microNetworkId: process.env.EC2_FIRECRAB_MICRO_NETWORK_ID!,
  sshProxyCommand: 'ssh -W %h:%p ubuntu@<host-public-ip>',
});

const sandbox = await provider.instances.create();
const result = await sandbox.runCommand('uname -r'); // guest kernel, not the host's
await provider.instances.destroy(sandbox.instanceId);
```

## Limitations

- Command execution uses per-VM managed SSH keys; `sshProxyCommand` is required for callers off the host since guest bridge IPs are host-local.
- No filesystem API, `getUrl` previews, snapshots, pause/resume, or background mode in current firecrab builds.
- `destroy` takes ~30s (graceful ACPI shutdown, no force flag).
